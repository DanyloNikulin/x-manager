use std::{
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

use x_manager_orchestrator::{analyst, config::Config, manager::ManagerClient, planner, researcher, worker};

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
    /// Run the weekly analyst now for every ready account (once per ISO week unless --force).
    Analyze {
        /// Ignore the weekly schedule (the weekly marker still prevents a second run).
        #[arg(long)]
        force: bool,
    },
    /// Run the researcher now for every account with research terms and a daily budget.
    Research {
        /// Ignore the daily budget and spacing (runs once more for every such account).
        #[arg(long)]
        force: bool,
    },
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
            // The planner is best-effort inside a pass: a failure is logged and the worker
            // still processes whatever is pending.
            match planner::plan_day(&config, &manager).await {
                Ok(planned) if planned > 0 => info!(planned, "planner queued tasks"),
                Ok(_) => {}
                Err(error) => warn!(error = %format!("{error:#}"), "planner pass failed; continuing with worker"),
            }
            match analyst::analyze_all(&config, &manager, false).await {
                Ok(ran) if ran > 0 => info!(ran, "analyst recorded analyses"),
                Ok(_) => {}
                Err(error) => warn!(error = %format!("{error:#}"), "analyst pass failed; continuing with worker"),
            }
            match researcher::research_all(&config, &manager, false).await {
                Ok(ran) if ran > 0 => info!(ran, "researcher recorded radar runs"),
                Ok(_) => {}
                Err(error) => warn!(error = %format!("{error:#}"), "researcher pass failed; continuing with worker"),
            }
            let processed = worker::run_once(&config, &manager).await?;
            info!(processed, "worker pass completed");
            Ok(())
        }
        Commands::Analyze { force } => {
            let ran = analyst::analyze_all(&config, &manager, force).await?;
            info!(ran, "analyst pass completed");
            Ok(())
        }
        Commands::Research { force } => {
            let ran = researcher::research_all(&config, &manager, force).await?;
            info!(ran, "researcher pass completed");
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
    // TOML accounts are the legacy/fallback source; profiles stored in X-Manager need no files.
    for (slot, account) in &config.accounts {
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
