use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use tracing::info;
use tracing_subscriber::EnvFilter;

use x_manager_orchestrator::{config::Config, manager::ManagerClient, planner, worker};

#[derive(Parser)]
#[command(name = "x-manager-orchestrator")]
#[command(about = "Runs subscription-backed content workers without exposing X credentials")]
struct Cli {
    #[arg(long, default_value = "orchestrator/config.toml")]
    config: PathBuf,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Doctor,
    /// Run the daily planner (if due) and then one worker pass.
    RunOnce,
    /// Run only the daily planner for every account with `posts_per_day > 0`.
    Plan,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    let config = Config::load(&cli.config)?;
    let token = config.admin_token()?;
    let manager = ManagerClient::new(&config.manager.base_url, token)?;

    match cli.command {
        Commands::Doctor => doctor(&config, &manager).await,
        Commands::RunOnce => {
            let planned = planner::plan_day(&config, &manager).await?;
            if planned > 0 {
                info!(planned, "planner queued tasks");
            }
            let processed = worker::run_once(&config, &manager).await?;
            info!(processed, "worker pass completed");
            Ok(())
        }
        Commands::Plan => {
            let planned = planner::plan_day(&config, &manager).await?;
            info!(planned, "planner pass completed");
            Ok(())
        }
    }
}

async fn doctor(config: &Config, manager: &ManagerClient) -> Result<()> {
    check_program(&config.writer.program)?;
    check_program(&config.validator.program)?;
    if let Some(planner) = &config.planner {
        check_program(&planner.program)?;
    }
    for slot in ["1", "2"] {
        let account = config
            .accounts
            .get(slot)
            .context("missing account config")?;
        let workspace = config.resolve(&account.workspace);
        if !workspace.is_dir() {
            bail!(
                "account slot {slot} workspace is missing: {}",
                workspace.display()
            );
        }
        for file in ["profile.md", "voice.md", "strategy.md", "memory.md"] {
            if !workspace.join(file).is_file() {
                bail!("account slot {slot} is missing {file}");
            }
        }
    }
    manager.readiness().await?;
    println!("doctor: ready");
    Ok(())
}

fn check_program(program: &str) -> Result<()> {
    if Path::new(program).components().count() > 1 && !Path::new(program).exists() {
        bail!("program does not exist: {program}");
    }
    let status = Command::new(program)
        .arg("--version")
        .status()
        .with_context(|| format!("failed to launch {program}"))?;
    if !status.success() {
        bail!("{program} --version failed");
    }
    Ok(())
}
