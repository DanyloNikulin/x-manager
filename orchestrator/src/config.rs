use std::{
    collections::HashMap,
    env, fs,
    path::{Path, PathBuf},
};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct Config {
    pub manager: ManagerConfig,
    pub worker: WorkerConfig,
    pub writer: AgentCommand,
    pub validator: AgentCommand,
    /// Optional daily planner agent; required once any account sets `posts_per_day`.
    pub planner: Option<AgentCommand>,
    pub accounts: HashMap<String, AccountConfig>,
    #[serde(skip)]
    pub root: PathBuf,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ManagerConfig {
    pub base_url: String,
    #[serde(default = "default_admin_token_env")]
    pub admin_token_env: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct WorkerConfig {
    pub id: String,
    #[serde(default = "default_assigned_agent")]
    pub assigned_agent: String,
    #[serde(default = "default_max_tasks")]
    pub max_tasks_per_run: usize,
    #[serde(default = "default_revision_rounds")]
    pub max_revision_rounds: usize,
    /// Local hour (0-23, in `plan_timezone`) from which the daily planner may run.
    #[serde(default = "default_plan_hour")]
    pub plan_hour: u32,
    /// IANA timezone that defines the planner's "day" and `plan_hour`.
    #[serde(default = "default_plan_timezone")]
    pub plan_timezone: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AgentCommand {
    pub program: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default = "default_timeout")]
    pub timeout_seconds: u64,
    pub schema_path: Option<PathBuf>,
    #[serde(default)]
    pub remove_env: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AccountConfig {
    pub workspace: PathBuf,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_post_mode")]
    pub post_mode: PublicationMode,
    #[serde(default = "default_inbound_reply_mode")]
    pub inbound_reply_mode: PublicationMode,
    #[serde(default = "default_outbound_reply_mode")]
    pub outbound_reply_mode: PublicationMode,
    /// How many original posts the daily planner may queue per day; 0 disables planning.
    #[serde(default)]
    pub posts_per_day: u32,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PublicationMode {
    Auto,
    Approval,
    Draft,
}

fn default_admin_token_env() -> String {
    "X_MANAGER_ADMIN_TOKEN".into()
}
fn default_assigned_agent() -> String {
    "subscription-agent".into()
}
fn default_language() -> String {
    "en".into()
}
fn default_post_mode() -> PublicationMode {
    PublicationMode::Auto
}
fn default_inbound_reply_mode() -> PublicationMode {
    PublicationMode::Auto
}
fn default_outbound_reply_mode() -> PublicationMode {
    PublicationMode::Approval
}
fn default_max_tasks() -> usize {
    2
}
fn default_revision_rounds() -> usize {
    1
}
fn default_timeout() -> u64 {
    600
}
fn default_plan_hour() -> u32 {
    9
}
fn default_plan_timezone() -> String {
    "UTC".into()
}

impl Config {
    pub fn load(path: &Path) -> Result<Self> {
        let raw = fs::read_to_string(path)
            .with_context(|| format!("failed to read config {}", path.display()))?;
        let mut config: Self = toml::from_str(&raw).context("invalid orchestrator TOML")?;
        config.root = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        config.validate()?;
        Ok(config)
    }

    pub fn admin_token(&self) -> Result<String> {
        env::var(&self.manager.admin_token_env)
            .with_context(|| format!("missing {}", self.manager.admin_token_env))
            .and_then(|value| {
                if value.trim().is_empty() {
                    bail!("{} is empty", self.manager.admin_token_env)
                }
                Ok(value)
            })
    }

    pub fn resolve(&self, path: &Path) -> PathBuf {
        if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.root.join(path)
        }
    }

    fn validate(&self) -> Result<()> {
        if !self.manager.base_url.starts_with("http://")
            && !self.manager.base_url.starts_with("https://")
        {
            bail!("manager.base_url must use http or https");
        }
        if self.worker.id.len() < 3
            || self.worker.id.len() > 100
            || !self
                .worker
                .id
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || ".-_:".contains(c))
        {
            bail!("worker.id contains unsupported characters");
        }
        if self.worker.max_tasks_per_run == 0 || self.worker.max_tasks_per_run > 20 {
            bail!("worker.max_tasks_per_run must be between 1 and 20");
        }
        if self.worker.max_revision_rounds > 1 {
            bail!("worker.max_revision_rounds is capped at 1 to protect subscription usage");
        }
        if self.worker.plan_hour > 23 {
            bail!("worker.plan_hour must be between 0 and 23");
        }
        if self.worker.plan_timezone.parse::<chrono_tz::Tz>().is_err() {
            bail!("worker.plan_timezone must be a valid IANA timezone");
        }
        for (slot, account) in &self.accounts {
            if account.posts_per_day > 5 {
                bail!("accounts.{slot}.posts_per_day is capped at 5 to protect subscription usage");
            }
            if account.posts_per_day > 0 && self.planner.is_none() {
                bail!("accounts.{slot}.posts_per_day requires a [planner] section");
            }
        }
        for slot in ["1", "2"] {
            if !self.accounts.contains_key(slot) {
                bail!("accounts.{slot} is required");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_worker_identifier() {
        let parsed: Config = toml::from_str(
            r#"
            [manager]
            base_url = "http://127.0.0.1:3999"

            [worker]
            id = "station.worker-1"

            [writer]
            program = "claude"

            [validator]
            program = "codex"

            [accounts.1]
            workspace = "../accounts/slot-1"

            [accounts.2]
            workspace = "../accounts/slot-2"
        "#,
        )
        .expect("config should deserialize");
        parsed.validate().expect("config should validate");
    }
}
