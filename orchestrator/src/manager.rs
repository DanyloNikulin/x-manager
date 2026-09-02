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
    tweets: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    media_urls: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reply_to_tweet_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_url: Option<&'a str>,
}

/// One post found by X-Manager's discovery search (`GET /api/discovery/topics`).
#[derive(Debug, Clone)]
pub struct DiscoveredPost {
    pub id: String,
    pub url: String,
    pub author: Option<String>,
    pub text: String,
    pub created_at: Option<String>,
    pub likes: u64,
    pub replies: u64,
    pub reposts: u64,
    pub quotes: u64,
}

/// Everything the worker hands back about one piece of content.
pub struct DraftPayload<'a> {
    pub text: &'a str,
    pub tweets: &'a [String],
    pub reply_to_tweet_id: Option<&'a str>,
    pub source_url: Option<&'a str>,
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
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    unique_title: bool,
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
        draft: DraftPayload<'_>,
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
                    text: draft.text,
                    tweets: draft.tweets.to_vec(),
                    media_urls: vec![],
                    reply_to_tweet_id: draft.reply_to_tweet_id,
                    source_url: draft.source_url,
                }),
            },
        )
        .await
    }

    pub async fn submit_review(
        &self,
        task_id: i64,
        worker_id: &str,
        draft: Option<DraftPayload<'_>>,
        output: Value,
    ) -> Result<()> {
        self.submit_result(
            task_id,
            ResultRequest {
                worker_id,
                outcome: "needs_review",
                output,
                publication_mode: None,
                draft: draft.map(|draft| DraftRequest {
                    text: draft.text,
                    tweets: draft.tweets.to_vec(),
                    media_urls: vec![],
                    reply_to_tweet_id: draft.reply_to_tweet_id,
                    source_url: draft.source_url,
                }),
            },
        )
        .await
    }

    /// The worker looked at the task and, per the account's playbook, will not answer it.
    /// X-Manager marks the task `skipped` and closes the mention it came from.
    pub async fn submit_skipped(&self, task_id: i64, worker_id: &str, output: Value) -> Result<()> {
        self.submit_result(
            task_id,
            ResultRequest {
                worker_id,
                outcome: "skipped",
                output,
                publication_mode: None,
                draft: None,
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

    /// The account digest the analyst reads: `GET /api/agent/accounts/:slot/digest?days=N`.
    pub async fn digest(&self, slot: u8, days: u32) -> Result<Value> {
        let days_value = days.to_string();
        let envelope = self
            .request(
                self.client
                    .get(format!("{}/api/agent/accounts/{slot}/digest", self.base_url)),
            )
            .query(&[("days", days_value.as_str())])
            .send()
            .await
            .context("digest request failed")?
            .error_for_status()
            .context("digest request was rejected")?
            .json::<Value>()
            .await
            .context("invalid digest")?;
        envelope
            .get("digest")
            .cloned()
            .context("digest response has no `digest` field")
    }

    /// Updates a task's status and details (`PATCH /api/agent/tasks/:id`); used to finish a
    /// marker that was reserved before a run's side effects.
    pub async fn update_task(&self, task_id: i64, status: &str, details: &str) -> Result<()> {
        self.request(
            self.client
                .patch(format!("{}/api/agent/tasks/{task_id}", self.base_url)),
        )
        .json(&serde_json::json!({ "status": status, "details": details }))
        .send()
        .await
        .context("task update request failed")?
        .error_for_status()
        .context("task update was rejected")?;
        Ok(())
    }

    /// Recent X posts matching one search term, through X-Manager's discovery search (which
    /// holds the bearer token, caches for 15 minutes, and scores by engagement per age).
    pub async fn discover(&self, term: &str, language: &str, limit: u32) -> Result<Vec<DiscoveredPost>> {
        let limit_value = limit.to_string();
        let body = self
            .request(
                self.client
                    .get(format!("{}/api/discovery/topics", self.base_url)),
            )
            .query(&[("keywords", term), ("lang", language), ("limit", limit_value.as_str())])
            .send()
            .await
            .context("discovery request failed")?
            .error_for_status()
            .context("discovery request was rejected")?
            .json::<Value>()
            .await
            .context("invalid discovery response")?;
        let topics = body
            .get("topics")
            .and_then(Value::as_array)
            .context("discovery response has no `topics`")?;
        let mut posts = Vec::with_capacity(topics.len());
        for topic in topics {
            let Some(id) = topic.get("id").and_then(Value::as_str) else { continue };
            let text = topic.get("text").and_then(Value::as_str).unwrap_or_default();
            if text.trim().is_empty() {
                continue;
            }
            let metric = |name: &str| {
                topic
                    .get("metrics")
                    .and_then(|metrics| metrics.get(name))
                    .and_then(Value::as_u64)
                    .unwrap_or(0)
            };
            posts.push(DiscoveredPost {
                id: id.to_owned(),
                url: topic.get("url").and_then(Value::as_str).unwrap_or_default().to_owned(),
                author: topic
                    .get("author")
                    .and_then(|author| author.get("username"))
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                text: text.to_owned(),
                created_at: topic.get("createdAt").and_then(Value::as_str).map(str::to_owned),
                likes: metric("likes"),
                replies: metric("replies"),
                reposts: metric("reposts"),
                quotes: metric("quotes"),
            });
        }
        Ok(posts)
    }

    /// Appends dated observations to the stored memory field, server-side in one
    /// transaction (`POST /api/agent/accounts/:slot/memory`), so no read-modify-write
    /// crosses two requests. `Ok(false)` when the slot has no stored profile.
    pub async fn append_memory(&self, slot: u8, day: &str, observations: &[String]) -> Result<bool> {
        let response = self
            .request(
                self.client
                    .post(format!("{}/api/agent/accounts/{slot}/memory", self.base_url)),
            )
            .json(&serde_json::json!({ "day": day, "observations": observations }))
            .send()
            .await
            .context("memory append request failed")?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(false);
        }
        response
            .error_for_status()
            .context("memory append was rejected")?;
        Ok(true)
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
                unique_title: false,
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

    /// Create-if-absent by title inside the campaign (one immediate transaction on the
    /// X-Manager side): `Ok(None)` when a task with this title already exists, so a
    /// once-per-period marker can be reserved atomically before any side effect.
    #[allow(clippy::too_many_arguments)]
    pub async fn create_task_unique(
        &self,
        campaign_id: i64,
        task_type: &str,
        title: &str,
        details: &str,
        priority: u8,
        assigned_agent: &str,
        status: &str,
    ) -> Result<Option<i64>> {
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
                unique_title: true,
            })
            .send()
            .await
            .context("task create request failed")?;
        if response.status() == StatusCode::CONFLICT {
            return Ok(None);
        }
        let response = response
            .error_for_status()
            .context("task create was rejected")?
            .json::<Value>()
            .await
            .context("invalid task create response")?;
        response
            .get("task")
            .and_then(|task| task.get("id"))
            .and_then(Value::as_i64)
            .map(Some)
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
