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
