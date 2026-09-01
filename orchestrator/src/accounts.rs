//! Resolves the effective configuration of an account slot.
//!
//! The Account console stores the brief and the autopilot switches in X-Manager
//! (`/api/agent/accounts/:slot`). That is the preferred source. When the API has no
//! stored profile for a slot — or the web app predates the endpoint — the legacy
//! `[accounts.N]` TOML block plus `accounts/slot-N/*.md` files are used instead, so
//! either side can be upgraded first.

use std::path::{Path, PathBuf};

use anyhow::Result;
use tracing::warn;

use crate::{
    config::{AccountConfig, Config, PublicationMode},
    manager::ManagerClient,
    models::AccountProfile,
    worker::load_account_context,
};

pub const ALL_SLOTS: [u8; 3] = [1, 2, 3];

#[derive(Debug, Clone)]
pub struct EffectiveAccount {
    pub slot: u8,
    pub language: String,
    pub post_mode: PublicationMode,
    pub inbound_reply_mode: PublicationMode,
    pub outbound_reply_mode: PublicationMode,
    pub posts_per_day: u32,
    pub plan_hour: u32,
    pub plan_timezone: String,
    /// Paused accounts are skipped by the planner and never auto-publish.
    pub paused: bool,
    /// Trusted account context in the same section format the prompts always used.
    pub context: String,
    /// Working directory for the CLI agents.
    pub workspace: PathBuf,
    /// "api" or "files" — recorded in audits so the operator knows which brief was used.
    pub source: &'static str,
}

impl EffectiveAccount {
    pub fn from_profile(profile: AccountProfile, workspace: PathBuf) -> Self {
        let context = format_context(&[
            ("profile.md", &profile.profile),
            ("voice.md", &profile.voice),
            ("strategy.md", &profile.strategy),
            ("memory.md", &profile.memory),
        ]);
        Self {
            slot: profile.slot,
            language: profile.language,
            post_mode: profile.post_mode,
            inbound_reply_mode: profile.inbound_reply_mode,
            outbound_reply_mode: profile.outbound_reply_mode,
            posts_per_day: profile.posts_per_day,
            plan_hour: profile.plan_hour,
            plan_timezone: profile.plan_timezone,
            paused: profile.status == "paused",
            context,
            workspace,
            source: "api",
        }
    }

    pub fn from_toml(slot: u8, account: &AccountConfig, config: &Config, context: String, workspace: PathBuf) -> Self {
        Self {
            slot,
            language: account.language.clone(),
            post_mode: account.post_mode,
            inbound_reply_mode: account.inbound_reply_mode,
            outbound_reply_mode: account.outbound_reply_mode,
            posts_per_day: account.posts_per_day,
            plan_hour: config.worker.plan_hour,
            plan_timezone: config.worker.plan_timezone.clone(),
            paused: false,
            context,
            workspace,
            source: "files",
        }
    }
}

pub fn format_context(sections: &[(&str, &str)]) -> String {
    sections
        .iter()
        .map(|(name, body)| format!("## {name}\n{body}"))
        .collect::<Vec<_>>()
        .join("\n\n")
}

/// Working directory for the CLIs: the TOML workspace when configured, otherwise the
/// conventional `accounts/slot-N` directory if it exists, otherwise the OS temp dir.
pub fn workspace_for(config: &Config, slot: u8, toml: Option<&AccountConfig>) -> PathBuf {
    if let Some(account) = toml {
        return config.resolve(&account.workspace);
    }
    let conventional = config.resolve(Path::new(&format!("../accounts/slot-{slot}")));
    if conventional.is_dir() {
        conventional
    } else {
        std::env::temp_dir()
    }
}

/// `Ok(None)` when the slot is configured nowhere.
pub async fn resolve_account(
    config: &Config,
    manager: &ManagerClient,
    slot: u8,
) -> Result<Option<EffectiveAccount>> {
    let toml = config.accounts.get(&slot.to_string());
    let workspace = workspace_for(config, slot, toml);

    match manager.account_profile(slot).await {
        Ok(Some(profile)) if profile.status != "needs-onboarding" => {
            return Ok(Some(EffectiveAccount::from_profile(profile, workspace)));
        }
        Ok(_) => {}
        Err(error) => {
            warn!(slot, error = %format!("{error:#}"), "account profile unavailable; using TOML + files");
        }
    }

    let Some(account) = toml else {
        return Ok(None);
    };
    let context = load_account_context(&workspace, account).await?;
    Ok(Some(EffectiveAccount::from_toml(slot, account, config, context, workspace)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_profile_becomes_the_same_context_format_as_files() {
        let profile = AccountProfile {
            slot: 1,
            status: "ready".into(),
            language: "en".into(),
            profile: "who".into(),
            voice: "how".into(),
            strategy: "what".into(),
            memory: "learned".into(),
            post_mode: PublicationMode::Auto,
            inbound_reply_mode: PublicationMode::Approval,
            outbound_reply_mode: PublicationMode::Draft,
            posts_per_day: 1,
            plan_hour: 9,
            plan_timezone: "America/New_York".into(),
            stored: true,
        };
        let account = EffectiveAccount::from_profile(profile, PathBuf::from("."));
        assert_eq!(
            account.context,
            "## profile.md\nwho\n\n## voice.md\nhow\n\n## strategy.md\nwhat\n\n## memory.md\nlearned"
        );
        assert!(!account.paused);
        assert_eq!(account.source, "api");
    }

    #[test]
    fn paused_profiles_are_flagged() {
        let profile = AccountProfile {
            slot: 2,
            status: "paused".into(),
            language: "en".into(),
            profile: String::new(),
            voice: String::new(),
            strategy: String::new(),
            memory: String::new(),
            post_mode: PublicationMode::Auto,
            inbound_reply_mode: PublicationMode::Auto,
            outbound_reply_mode: PublicationMode::Auto,
            posts_per_day: 3,
            plan_hour: 9,
            plan_timezone: "UTC".into(),
            stored: true,
        };
        assert!(EffectiveAccount::from_profile(profile, PathBuf::from(".")).paused);
    }
}
