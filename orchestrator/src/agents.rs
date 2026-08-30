use std::{env, path::Path, process::Stdio, time::Duration};

use anyhow::{Context, Result, bail};
use serde::de::DeserializeOwned;
use tempfile::tempdir;
use tokio::{
    fs,
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    process::Command,
    time::timeout,
};

use crate::config::{AgentCommand, Config};

const MAX_AGENT_OUTPUT_BYTES: usize = 2 * 1024 * 1024;
const MAX_AGENT_ERROR_BYTES: usize = 256 * 1024;
const SAFE_INHERITED_ENV: &[&str] = &[
    "PATH",
    "PATHEXT",
    "SystemRoot",
    "ComSpec",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "TEMP",
    "TMP",
    "TMPDIR",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
];

pub async fn run_json_agent<T: DeserializeOwned>(
    config: &Config,
    command_config: &AgentCommand,
    prompt: &str,
    workdir: &Path,
) -> Result<T> {
    let temp_dir = tempdir().context("failed to create agent result directory")?;
    let output_path = temp_dir.path().join("result.json");
    let schema_path = command_config
        .schema_path
        .as_ref()
        .map(|path| config.resolve(path));
    let schema_json = match &schema_path {
        Some(path) => Some(
            fs::read_to_string(path)
                .await
                .with_context(|| format!("failed to read schema {}", path.display()))?,
        ),
        None => None,
    };

    let mut args = Vec::with_capacity(command_config.args.len());
    let mut expects_output_file = false;
    for arg in &command_config.args {
        let expanded = match arg.as_str() {
            "{output}" => {
                expects_output_file = true;
                output_path.to_string_lossy().into_owned()
            }
            "{schema}" => schema_path
                .as_ref()
                .context("agent args use {schema}, but schema_path is not configured")?
                .to_string_lossy()
                .into_owned(),
            "{schema_json}" => schema_json
                .as_ref()
                .context("agent args use {schema_json}, but schema_path is not configured")?
                .clone(),
            _ => arg.clone(),
        };
        args.push(expanded);
    }

    let mut command = Command::new(&command_config.program);
    command
        .args(&args)
        .current_dir(workdir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    command.env_clear();
    for name in SAFE_INHERITED_ENV {
        if *name != config.manager.admin_token_env
            && !command_config
                .remove_env
                .iter()
                .any(|blocked| blocked == name)
            && let Some(value) = env::var_os(name)
        {
            command.env(name, value);
        }
    }

    let mut child = command
        .spawn()
        .with_context(|| format!("failed to start {}", command_config.program))?;
    let mut stdin = child.stdin.take().context("agent stdin pipe is missing")?;
    let mut stdout = child
        .stdout
        .take()
        .context("agent stdout pipe is missing")?;
    let mut stderr = child
        .stderr
        .take()
        .context("agent stderr pipe is missing")?;
    let execution = async {
        let (status, (), stdout, stderr) = tokio::try_join!(
            async { child.wait().await.context("failed to wait for agent") },
            async {
                stdin
                    .write_all(prompt.as_bytes())
                    .await
                    .context("failed to send agent prompt")?;
                stdin
                    .shutdown()
                    .await
                    .context("failed to close agent prompt pipe")?;
                Ok::<_, anyhow::Error>(())
            },
            read_capped(&mut stdout, MAX_AGENT_OUTPUT_BYTES),
            read_capped(&mut stderr, MAX_AGENT_ERROR_BYTES),
        )?;
        Ok::<_, anyhow::Error>((status, stdout, stderr))
    };
    let (status, stdout, stderr) = match timeout(
        Duration::from_secs(command_config.timeout_seconds),
        execution,
    )
    .await
    {
        Ok(result) => result?,
        Err(_) => {
            let _ = child.kill().await;
            bail!("{} timed out", command_config.program);
        }
    };

    if !status.success() {
        let stderr = String::from_utf8_lossy(&stderr);
        bail!(
            "{} failed: {}",
            command_config.program,
            truncate(&stderr, 4_000)
        );
    }

    let raw = if expects_output_file {
        let metadata = fs::metadata(&output_path).await.with_context(|| {
            format!(
                "{} did not write {}",
                command_config.program,
                output_path.display()
            )
        })?;
        if metadata.len() > MAX_AGENT_OUTPUT_BYTES as u64 {
            bail!("agent output exceeded {MAX_AGENT_OUTPUT_BYTES} bytes");
        }
        fs::read_to_string(&output_path)
            .await
            .with_context(|| format!("failed to read agent output {}", output_path.display()))?
    } else {
        String::from_utf8(stdout).context("agent output was not UTF-8")?
    };

    if raw.len() > MAX_AGENT_OUTPUT_BYTES {
        bail!("agent output exceeded {MAX_AGENT_OUTPUT_BYTES} bytes");
    }
    parse_json_payload(&raw)
}

async fn read_capped<R: AsyncRead + Unpin>(reader: &mut R, limit: usize) -> Result<Vec<u8>> {
    let mut output = Vec::with_capacity(limit.min(16 * 1024));
    let mut chunk = [0_u8; 8 * 1024];
    loop {
        let read = reader
            .read(&mut chunk)
            .await
            .context("failed to read agent output")?;
        if read == 0 {
            return Ok(output);
        }
        if output.len().saturating_add(read) > limit {
            bail!("agent output exceeded {limit} bytes");
        }
        output.extend_from_slice(&chunk[..read]);
    }
}

pub fn parse_json_payload<T: DeserializeOwned>(raw: &str) -> Result<T> {
    if let Ok(parsed) = serde_json::from_str::<T>(raw.trim()) {
        return Ok(parsed);
    }

    if let Ok(wrapper) = serde_json::from_str::<serde_json::Value>(raw.trim()) {
        for key in ["structured_output", "result", "message", "content"] {
            if let Some(inner) = wrapper.get(key) {
                if let Some(inner) = inner.as_str() {
                    if let Ok(parsed) = parse_json_payload::<T>(inner) {
                        return Ok(parsed);
                    }
                } else if let Ok(parsed) = serde_json::from_value::<T>(inner.clone()) {
                    return Ok(parsed);
                }
            }
        }
    }

    if let (Some(start), Some(end)) = (raw.find('{'), raw.rfind('}'))
        && start < end
        && let Ok(parsed) = serde_json::from_str::<T>(&raw[start..=end])
    {
        return Ok(parsed);
    }
    bail!("agent returned invalid structured JSON")
}

fn truncate(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::WriterOutput;

    #[test]
    fn parses_claude_json_wrapper() {
        let raw = r#"{"result":"{\"variants\":[{\"text\":\"hello\",\"rationale\":\"\",\"sources\":[]}],\"recommended_index\":0}"}"#;
        let output: WriterOutput = parse_json_payload(raw).expect("wrapper should parse");
        assert_eq!(output.recommended().expect("candidate").text, "hello");
    }

    #[test]
    fn parses_claude_structured_output() {
        let raw = r#"{"structured_output":{"variants":[{"text":"hello","rationale":"","sources":[]}],"recommended_index":0}}"#;
        let output: WriterOutput = parse_json_payload(raw).expect("structured output should parse");
        assert_eq!(output.recommended().expect("candidate").text, "hello");
    }

    #[tokio::test]
    async fn rejects_agent_output_above_the_cap() {
        let mut input = &b"12345"[..];
        let error = read_capped(&mut input, 4)
            .await
            .expect_err("oversized output must fail");
        assert!(error.to_string().contains("exceeded 4 bytes"));
    }
}
