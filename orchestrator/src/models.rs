use serde::{Deserialize, Serialize};

use crate::config::PublicationMode;

/// Per-account brief and switches as served by `/api/agent/accounts/:slot`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub slot: u8,
    pub status: String,
    pub language: String,
    #[serde(default)]
    pub profile: String,
    #[serde(default)]
    pub voice: String,
    #[serde(default)]
    pub strategy: String,
    #[serde(default)]
    pub memory: String,
    /// Reply playbook: triage classes and rules for inbound mentions (reply tasks only).
    #[serde(default)]
    pub playbook: String,
    pub post_mode: PublicationMode,
    pub inbound_reply_mode: PublicationMode,
    pub outbound_reply_mode: PublicationMode,
    pub posts_per_day: u32,
    pub plan_hour: u32,
    pub plan_timezone: String,
    /// How many replies the account sends in one chain before the intake stops queueing them.
    #[serde(default = "default_max_replies_per_conversation")]
    pub max_replies_per_conversation: u32,
    /// Search terms the researcher watches on X; empty means the researcher is off.
    #[serde(default)]
    pub research_terms: Vec<String>,
    /// Researcher runs per local day (0 = off), spread evenly.
    #[serde(default)]
    pub research_runs_per_day: u32,
    /// The connected X handle, when the API knows it (used to skip the account's own posts).
    #[serde(default)]
    pub username: Option<String>,
    /// False when the API answered with defaults because no row exists yet.
    #[serde(default)]
    pub stored: bool,
}

pub fn default_max_replies_per_conversation() -> u32 {
    2
}

#[derive(Debug, Clone, Deserialize)]
pub struct AccountProfileEnvelope {
    pub profile: AccountProfile,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerTask {
    pub id: i64,
    pub campaign_id: i64,
    pub task_type: String,
    pub title: String,
    pub details: Option<String>,
    pub account_slot: u8,
    pub campaign_name: String,
    pub campaign_objective: String,
    pub campaign_instructions: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TaskList {
    pub items: Vec<WorkerTask>,
}

// ---------------------------------------------------------------------------
// Daily planner
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannerOutput {
    /// Deliberately required: with a default, the CLI's own `{"type":"result",...}`
    /// envelope would deserialize as an empty plan before the payload is unwrapped.
    pub tasks: Vec<PlannedTask>,
    /// What the planner searched and rejected; recorded in the daily marker task.
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlannedTask {
    pub topic: String,
    pub angle: String,
    #[serde(default)]
    pub pillar: String,
    /// "post" (default) or "thread" for a multi-tweet breakdown of a long read.
    #[serde(default)]
    pub format: String,
    /// Upper bound on tweets for a thread; ignored for posts.
    #[serde(default)]
    pub max_tweets: u32,
    #[serde(default)]
    pub source_notes: Vec<SourceNote>,
}

impl PlannedTask {
    pub fn is_thread(&self) -> bool {
        self.format.eq_ignore_ascii_case("thread")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceNote {
    pub url: String,
    #[serde(default)]
    pub note: String,
    /// Short verbatim excerpts (≤ 30 words each) the writer may quote with attribution.
    #[serde(default)]
    pub quotes: Vec<String>,
}

// ---------------------------------------------------------------------------
// Manager API shapes used by the planner
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Campaign {
    pub id: i64,
    pub name: String,
    pub status: String,
    pub account_slot: u8,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CampaignList {
    pub items: Vec<Campaign>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CampaignEnvelope {
    pub campaign: Campaign,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CampaignTask {
    pub id: i64,
    pub title: String,
    pub status: String,
    pub task_type: String,
    #[serde(default)]
    pub details: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CampaignTaskList {
    pub items: Vec<CampaignTask>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPost {
    pub id: i64,
    pub text: String,
    pub status: String,
    #[serde(default)]
    pub scheduled_time: Option<serde_json::Value>,
    /// Set when the post is itself a reply; lets the worker show the writer what it already answered.
    #[serde(default)]
    pub reply_to_tweet_id: Option<String>,
}

/// `/api/scheduler/posts` has used both `posts` and `items` as its list key.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct RecentPostList {
    #[serde(default)]
    pub posts: Vec<RecentPost>,
    #[serde(default)]
    pub items: Vec<RecentPost>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriterOutput {
    /// Empty only for a reply the writer decided, per the playbook, not to answer. Deliberately
    /// required (no default): with a default, the CLI envelope `{"type":"result",...}` would
    /// deserialize as an empty writer output before the payload is unwrapped.
    pub variants: Vec<ContentCandidate>,
    pub recommended_index: usize,
    /// Reply tasks only: what the writer made of the parent before (or instead of) writing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub triage: Option<Triage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Triage {
    pub class: String,
    pub decision: TriageDecision,
    #[serde(default)]
    pub reason: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TriageDecision {
    Answer,
    Ignore,
    Escalate,
}

// ---------------------------------------------------------------------------
// Weekly analyst
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalystOutput {
    /// Required on purpose: the CLI envelope must never parse as an empty analysis.
    pub report: String,
    #[serde(default)]
    pub observations: Vec<String>,
    #[serde(default)]
    pub proposals: Vec<Proposal>,
}

// ---------------------------------------------------------------------------
// Researcher
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearcherOutput {
    /// Required on purpose: the CLI envelope must never parse as an empty radar.
    pub radar: Vec<String>,
    #[serde(default)]
    pub opportunities: Vec<Opportunity>,
}

/// One thing the account could engage with; a suggestion for the operator.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Opportunity {
    /// reply | quote | repost | watch
    pub kind: String,
    pub tweet_id: String,
    pub url: String,
    #[serde(default)]
    pub author: String,
    pub why: String,
    #[serde(default)]
    pub angle: String,
    #[serde(default = "default_priority")]
    pub priority: u8,
    /// Filled by the worker from the search result, never by the model.
    #[serde(default)]
    pub parent_text: String,
}

fn default_priority() -> u8 {
    2
}

/// One concrete edit to an account-layer field or setting, for the operator to apply.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Proposal {
    pub target: String,
    /// Exact text to replace; empty means append.
    #[serde(default)]
    pub current: String,
    pub proposed: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub evidence: String,
    #[serde(default)]
    pub confidence: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentCandidate {
    /// The post, or the first tweet when `tweets` is a thread.
    pub text: String,
    /// Whole thread, first tweet included; empty for a single post.
    #[serde(default)]
    pub tweets: Vec<String>,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub sources: Vec<String>,
}

impl ContentCandidate {
    /// Trimmed, non-empty tweets when the candidate is a thread (two or more), else empty.
    pub fn thread_tweets(&self) -> Vec<String> {
        let tweets: Vec<String> = self
            .tweets
            .iter()
            .map(|tweet| tweet.trim().to_owned())
            .filter(|tweet| !tweet.is_empty())
            .collect();
        if tweets.len() >= 2 { tweets } else { Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    Pass,
    Revise,
    Block,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidatorOutput {
    pub verdict: Verdict,
    pub score: u8,
    #[serde(default)]
    pub issues: Vec<String>,
    #[serde(default)]
    pub revision_instructions: Vec<String>,
}

impl WriterOutput {
    pub fn recommended(&self) -> anyhow::Result<&ContentCandidate> {
        let candidate = self
            .variants
            .get(self.recommended_index)
            .ok_or_else(|| anyhow::anyhow!("recommended_index is outside variants"))?;
        if candidate.text.trim().is_empty() {
            anyhow::bail!("recommended candidate is empty");
        }
        Ok(candidate)
    }
}
