use serde::{Deserialize, Serialize};

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
    #[serde(default)]
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
    #[serde(default)]
    pub source_notes: Vec<SourceNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SourceNote {
    pub url: String,
    #[serde(default)]
    pub note: String,
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
    pub variants: Vec<ContentCandidate>,
    pub recommended_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentCandidate {
    pub text: String,
    #[serde(default)]
    pub rationale: String,
    #[serde(default)]
    pub sources: Vec<String>,
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
