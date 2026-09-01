use anyhow::{Context, Result, bail};
use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::Value;

use crate::{
    config::PublicationMode,
    models::{
        AccountProfile, AccountProfileEnvelope, CampaignEnvelope, CampaignList, CampaignTask,
        CampaignTaskList, RecentPost, RecentPostList, TaskList, WorkerTask,
    },
};

#[derive(Clone)]
pub struct ManagerClient {
    client: Client,
    base_url: String,
    admin_token: String,
}

#[derive(Serialize)]
struct ClaimRequest<'a> {
    worker_id: &'a str,
    assigned_agent: &'a str,
}

#[derive(Serialize)]
struct ResultRequest<'a> {
    worker_id: &'a str,
    outcome: &'a str,
    output: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    publication_mode: Option<PublicationMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    draft: Option<DraftRequest<'a>>,
}

#[derive(Serialize)]
struct DraftRequest<'a> {
    text: &'a str,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    media_urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to_tweet_id: Option<&'a str>,
}

#[derive(Serialize)]
struct CampaignCreateRequest<'a> {
    name: &'a str,
    objective: &'a str,
    account_slot: u8,
    status: &'a str,
}

#[derive(Serialize)]
struct TaskCreateRequest<'a> {
    task_type: &'a str,
    title: &'a str,
    details: &'a str,
    priority: u8,
    assigned_agent: &'a str,
    status: &'a str,
}

impl ManagerClient {
    pub fn new(base_url: &str, admin_token: String) -> Result<Self> {
        let client = Client::builder()
            .build()
            .context("failed to create HTTP client")?;
        Ok(Self {
            client,
            base_url: base_url.trim_end_matches('/').to_owned(),
            admin_token,
        })
    }

    pub async fn readiness(&self) -> Result<()> {
        let response = self
            .request(
                self.client
                    .get(format!("{}/api/system/readiness", self.base_url)),
            )
            .send()
            .await
            .context("X-Manager readiness request failed")?;
        if !response.status().is_success() {
            bail!("X-Manager readiness returned {}", response.status());
        }
        Ok(())
    }

    pub async fn list_pending(
        &self,
        assigned_agent: &str,
        limit: usize,
    ) -> Result<Vec<WorkerTask>> {
        let limit_value = limit.to_string();
        let response = self
            .request(
                self.client
                    .get(format!("{}/api/agent/tasks", self.base_url)),
            )
            .query(&[
                ("status", "pending"),
                ("assigned_agent", assigned_agent),
                ("limit", limit_value.as_str()),
            ])
            .send()
            .await
            .context("failed to list worker tasks")?
            .error_for_status()
            .context("worker task list was rejected")?;
        Ok(response
            .json::<TaskList>()
            .await
            .context("invalid worker task list")?
            .items)
    }

    pub async fn claim(&self, task_id: i64, worker_id: &str, assigned_agent: &str) -> Result<bool> {
        let response = self
            .request(
                self.client
                    .post(format!("{}/api/agent/tasks/{task_id}/claim", self.base_url)),
            )
            .json(&ClaimRequest {
                worker_id,
                assigned_agent,
            })
            .send()
            .await
            .context("task claim request failed")?;
        if response.status() == StatusCode::CONFLICT {
            return Ok(false);
        }
        response
            .error_for_status()
            .context("task claim was rejected")?;
        Ok(true)
    }

    pub async fn submit_draft(
        &self,
        task_id: i64,
        worker_id: &str,
        text: &str,
        reply_to_tweet_id: Option<&str>,
        publication_mode: PublicationMode,
        output: Value,
    ) -> Result<()> {
        self.submit_result(
            task_id,
            ResultRequest {
                worker_id,
                outcome: "drafted",
                output,
                publication_mode: Some(publication_mode),
                draft: Some(DraftRequest {
                    text,
                    media_urls: vec![],
                    reply_to_tweet_id,
                }),
            },
        )
        .await
    }

    pub async fn submit_review(
        &self,
        task_id: i64,
        worker_id: &str,
        text: Option<&str>,
        reply_to_tweet_id: Option<&str>,
        output: Value,
    ) -> Result<()> {
        self.submit_result(
            task_id,
            ResultRequest {
                worker_id,
                outcome: "needs_review",
                output,
                publication_mode: None,
                draft: text.map(|text| DraftRequest {
                    text,
                    media_urls: vec![],
                    reply_to_tweet_id,
                }),
            },
        )
        .await
    }

    pub async fn submit_failure(&self, task_id: i64, worker_id: &str, message: &str) -> Result<()> {
        self.submit_result(
            task_id,
            ResultRequest {
                worker_id,
                outcome: "failed",
                output: serde_json::json!({ "error": message }),
                publication_mode: None,
                draft: None,
            },
        )
        .await
    }

    /// The account's stored brief and switches, or `None` when X-Manager has no row for the
    /// slot yet (or predates the endpoint), in which case the caller falls back to TOML + files.
    pub async fn account_profile(&self, slot: u8) -> Result<Option<AccountProfile>> {
        let response = self
            .request(
                self.client
                    .get(format!("{}/api/agent/accounts/{slot}", self.base_url)),
            )
            .send()
            .await
            .context("account profile request failed")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        let envelope = response
            .error_for_status()
            .context("account profile request was rejected")?
            .json::<AccountProfileEnvelope>()
            .await
            .context("invalid account profile")?;
        Ok(envelope.profile.stored.then_some(envelope.profile))
    }

    /// Returns the id of the active campaign with this name for the slot, creating it if needed.
    pub async fn find_or_create_campaign(
        &self,
        account_slot: u8,
        name: &str,
        objective: &str,
    ) -> Result<i64> {
        let slot = account_slot.to_string();
        let existing = self
            .request(
                self.client
                    .get(format!("{}/api/agent/campaigns", self.base_url)),
            )
            .query(&[("account_slot", slot.as_str()), ("status", "active")])
            .send()
            .await
            .context("failed to list campaigns")?
            .error_for_status()
            .context("campaign list was rejected")?
            .json::<CampaignList>()
            .await
            .context("invalid campaign list")?;
        if let Some(campaign) = existing.items.iter().find(|campaign| campaign.name == name) {
            return Ok(campaign.id);
        }

        let created = self
            .request(
                self.client
                    .post(format!("{}/api/agent/campaigns", self.base_url)),
            )
            .json(&CampaignCreateRequest {
                name,
                objective,
                account_slot,
                status: "active",
            })
            .send()
            .await
            .context("campaign create request failed")?
            .error_for_status()
            .context("campaign create was rejected")?
            .json::<CampaignEnvelope>()
            .await
            .context("invalid campaign create response")?;
        Ok(created.campaign.id)
    }

    pub async fn list_campaign_tasks(&self, campaign_id: i64) -> Result<Vec<CampaignTask>> {
        let response = self
            .request(self.client.get(format!(
                "{}/api/agent/campaigns/{campaign_id}/tasks",
                self.base_url
            )))
            .send()
            .await
            .context("failed to list campaign tasks")?
            .error_for_status()
            .context("campaign task list was rejected")?;
        Ok(response
            .json::<CampaignTaskList>()
            .await
            .context("invalid campaign task list")?
            .items)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_task(
        &self,
        campaign_id: i64,
        task_type: &str,
        title: &str,
        details: &str,
        priority: u8,
        assigned_agent: &str,
        status: &str,
    ) -> Result<i64> {
        let response = self
            .request(self.client.post(format!(
                "{}/api/agent/campaigns/{campaign_id}/tasks",
                self.base_url
            )))
            .json(&TaskCreateRequest {
                task_type,
                title,
                details,
                priority,
                assigned_agent,
                status,
            })
            .send()
            .await
            .context("task create request failed")?
            .error_for_status()
            .context("task create was rejected")?
            .json::<Value>()
            .await
            .context("invalid task create response")?;
        response
            .get("task")
            .and_then(|task| task.get("id"))
            .and_then(Value::as_i64)
            .context("task create response has no id")
    }

    /// Most recent posts of the slot (newest first), scheduled or already published.
    pub async fn recent_posts(&self, account_slot: u8, limit: usize) -> Result<Vec<RecentPost>> {
        let slot = account_slot.to_string();
        let limit_value = (limit * 2).max(limit).to_string();
        let list = self
            .request(
                self.client
                    .get(format!("{}/api/scheduler/posts", self.base_url)),
            )
            .query(&[("account_slot", slot.as_str()), ("limit", limit_value.as_str())])
            .send()
            .await
            .context("failed to list recent posts")?
            .error_for_status()
            .context("recent post list was rejected")?
            .json::<RecentPostList>()
            .await
            .context("invalid recent post list")?;
        let mut posts = if list.posts.is_empty() { list.items } else { list.posts };
        posts.retain(|post| post.status == "posted" || post.status == "scheduled");
        posts.sort_by(|a, b| b.id.cmp(&a.id));
        posts.truncate(limit);
        Ok(posts)
    }

    async fn submit_result(&self, task_id: i64, body: ResultRequest<'_>) -> Result<()> {
        self.request(self.client.post(format!(
            "{}/api/agent/tasks/{task_id}/result",
            self.base_url
        )))
        .json(&body)
        .send()
        .await
        .context("task result request failed")?
        .error_for_status()
        .context("task result was rejected")?;
        Ok(())
    }

    fn request(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        builder.bearer_auth(&self.admin_token)
    }
}
