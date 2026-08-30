use anyhow::{Context, Result, bail};
use reqwest::{Client, StatusCode};
use serde::Serialize;
use serde_json::Value;

use crate::models::{TaskList, WorkerTask};

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
        output: Value,
    ) -> Result<()> {
        self.submit_result(
            task_id,
            ResultRequest {
                worker_id,
                outcome: "drafted",
                output,
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
                draft: None,
            },
        )
        .await
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
