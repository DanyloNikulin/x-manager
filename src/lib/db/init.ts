import type BetterSqlite3 from 'better-sqlite3';
import { ensureLegacyColumns } from './init-columns';

let isInitialized = false;

type SqliteDb = BetterSqlite3.Database;

function sleepMs(ms: number): void {
  // Synchronous sleep without spinning the CPU.
  const sab = new SharedArrayBuffer(4);
  const view = new Int32Array(sab);
  Atomics.wait(view, 0, 0, ms);
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED';
}

function execWithRetry(sqlite: SqliteDb, sqlText: string, attempts = 8, delayMs = 120): void {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      sqlite.exec(sqlText);
      return;
    } catch (error) {
      if (isSqliteBusyError(error) && attempt < attempts - 1) {
        sleepMs(delayMs);
        continue;
      }
      throw error;
    }
  }
}

export function ensureSchema(sqlite: SqliteDb): void {
  if (isInitialized) {
    return;
  }

  execWithRetry(sqlite, `
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE IF NOT EXISTS user (
      id INTEGER PRIMARY KEY,
      twitter_user_id TEXT,
      twitter_username TEXT,
      twitter_display_name TEXT,
      twitter_access_token TEXT,
      twitter_access_token_secret TEXT
    );

    CREATE TABLE IF NOT EXISTS x_accounts (
      id INTEGER PRIMARY KEY,
      slot INTEGER NOT NULL UNIQUE,
      twitter_user_id TEXT,
      twitter_username TEXT,
      twitter_display_name TEXT,
      twitter_access_token TEXT,
      twitter_access_token_secret TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scheduled_posts (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      source_url TEXT,
      dedupe_key TEXT,
      thread_id TEXT,
      thread_index INTEGER,
      media_urls TEXT,
      community_id TEXT,
      reply_to_tweet_id TEXT,
      scheduled_time INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      twitter_post_id TEXT,
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS community_tags (
      id INTEGER PRIMARY KEY,
      tag_name TEXT NOT NULL,
      community_id TEXT NOT NULL,
      community_name TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS system_prompts (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS topic_search_cache (
      id INTEGER PRIMARY KEY,
      cache_key TEXT NOT NULL UNIQUE,
      query TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      id INTEGER PRIMARY KEY,
      setting_key TEXT NOT NULL UNIQUE,
      setting_value TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS scheduler_locks (
      id INTEGER PRIMARY KEY,
      lock_key TEXT NOT NULL UNIQUE,
      owner_id TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS engagement_inbox (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      conversation_id TEXT,
      author_user_id TEXT,
      author_username TEXT,
      text TEXT NOT NULL,
      raw_payload TEXT NOT NULL,
      received_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'new',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS engagement_actions (
      id INTEGER PRIMARY KEY,
      inbox_id INTEGER,
      account_slot INTEGER NOT NULL DEFAULT 1,
      action_type TEXT NOT NULL,
      target_id TEXT,
      payload TEXT NOT NULL,
      result TEXT,
      status TEXT NOT NULL,
      error_message TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaigns (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      objective TEXT NOT NULL,
      account_slot INTEGER NOT NULL DEFAULT 1,
      instructions TEXT,
      start_at INTEGER,
      end_at INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaign_tasks (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      task_type TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT,
      due_at INTEGER,
      priority INTEGER NOT NULL DEFAULT 2,
      assigned_agent TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      output TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS campaign_approvals (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER NOT NULL,
      task_id INTEGER,
      requested_by TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'pending',
      decision_note TEXT,
      requested_at INTEGER DEFAULT (unixepoch()),
      decided_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_topic_search_cache_key
      ON topic_search_cache(cache_key);

    CREATE INDEX IF NOT EXISTS idx_topic_search_cache_expires
      ON topic_search_cache(expires_at);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_status_time
      ON scheduled_posts(status, scheduled_time);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_account_status_time
      ON scheduled_posts(account_slot, status, scheduled_time);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_x_accounts_slot
      ON x_accounts(slot);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_app_settings_key
      ON app_settings(setting_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduler_locks_key
      ON scheduler_locks(lock_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_inbox_source
      ON engagement_inbox(account_slot, source_type, source_id);

    CREATE INDEX IF NOT EXISTS idx_engagement_inbox_status
      ON engagement_inbox(account_slot, status, received_at);

    CREATE INDEX IF NOT EXISTS idx_engagement_actions_created
      ON engagement_actions(account_slot, created_at);

    CREATE INDEX IF NOT EXISTS idx_campaigns_status
      ON campaigns(account_slot, status, start_at, end_at);

    CREATE INDEX IF NOT EXISTS idx_campaign_tasks_campaign
      ON campaign_tasks(campaign_id, status, due_at);

    CREATE INDEX IF NOT EXISTS idx_campaign_approvals_status
      ON campaign_approvals(campaign_id, status, requested_at);

    -- P1.1: Idempotency
    CREATE TABLE IF NOT EXISTS api_idempotency (
      id INTEGER PRIMARY KEY,
      scope TEXT NOT NULL,
      idempotency_key TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      response_json TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_api_idempotency_scope_key
      ON api_idempotency(scope, idempotency_key);
    CREATE INDEX IF NOT EXISTS idx_api_idempotency_expires
      ON api_idempotency(expires_at);

    -- P1.2: Durable Runs Model
    CREATE TABLE IF NOT EXISTS agent_runs (
      id INTEGER PRIMARY KEY,
      campaign_id INTEGER,
      status TEXT NOT NULL DEFAULT 'running',
      dry_run INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER DEFAULT (unixepoch()),
      finished_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_campaign
      ON agent_runs(campaign_id, status, started_at);

    CREATE TABLE IF NOT EXISTS agent_run_steps (
      id INTEGER PRIMARY KEY,
      run_id INTEGER NOT NULL,
      task_id INTEGER,
      step_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER DEFAULT (unixepoch()),
      finished_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_steps_run
      ON agent_run_steps(run_id, started_at);

    -- P1.5: Scheduled Engagement Actions
    CREATE TABLE IF NOT EXISTS scheduled_actions (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      action_type TEXT NOT NULL,
      target_id TEXT,
      payload_json TEXT NOT NULL,
      scheduled_time INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'scheduled',
      result_json TEXT,
      error TEXT,
      idempotency_key TEXT,
      run_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_actions_status_time
      ON scheduled_actions(status, scheduled_time);
    CREATE INDEX IF NOT EXISTS idx_scheduled_actions_account
      ON scheduled_actions(account_slot, status, scheduled_time);

    -- P2.3: API Call Log
    CREATE TABLE IF NOT EXISTS x_api_calls (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_x_api_calls_slot_created
      ON x_api_calls(account_slot, created_at);

    -- P3.1: Engagement Cursors
    CREATE TABLE IF NOT EXISTS engagement_cursors (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL,
      cursor_type TEXT NOT NULL,
      cursor_value TEXT NOT NULL,
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_engagement_cursors_slot_type
      ON engagement_cursors(account_slot, cursor_type);

    -- P3.3: Inbox Tags and Notes
    CREATE TABLE IF NOT EXISTS inbox_tags (
      id INTEGER PRIMARY KEY,
      inbox_id INTEGER NOT NULL,
      tag TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_tags_inbox
      ON inbox_tags(inbox_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_inbox_tags_unique
      ON inbox_tags(inbox_id, tag);

    CREATE TABLE IF NOT EXISTS inbox_notes (
      id INTEGER PRIMARY KEY,
      inbox_id INTEGER NOT NULL,
      author TEXT NOT NULL DEFAULT 'operator',
      note TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_inbox_notes_inbox
      ON inbox_notes(inbox_id);

    -- P4.2: Drafts and Templates
    CREATE TABLE IF NOT EXISTS draft_posts (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      media_urls TEXT,
      community_id TEXT,
      reply_to_tweet_id TEXT,
      thread_id TEXT,
      thread_index INTEGER,
      source TEXT,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_draft_posts_account
      ON draft_posts(account_slot, created_at);

    CREATE TABLE IF NOT EXISTS post_templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      template TEXT NOT NULL,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    -- Phase 1: Post Metrics
    CREATE TABLE IF NOT EXISTS post_metrics (
      id INTEGER PRIMARY KEY,
      scheduled_post_id INTEGER NOT NULL,
      twitter_post_id TEXT NOT NULL,
      account_slot INTEGER NOT NULL,
      impressions INTEGER NOT NULL DEFAULT 0,
      likes INTEGER NOT NULL DEFAULT 0,
      retweets INTEGER NOT NULL DEFAULT 0,
      replies INTEGER NOT NULL DEFAULT 0,
      quotes INTEGER NOT NULL DEFAULT 0,
      bookmarks INTEGER NOT NULL DEFAULT 0,
      fetched_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_post_metrics_twitter_id
      ON post_metrics(twitter_post_id);
    CREATE INDEX IF NOT EXISTS idx_post_metrics_scheduled_post
      ON post_metrics(scheduled_post_id, fetched_at);
    CREATE INDEX IF NOT EXISTS idx_post_metrics_slot_fetched
      ON post_metrics(account_slot, fetched_at);

    -- Phase 4: Saved Replies
    CREATE TABLE IF NOT EXISTS saved_replies (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT,
      text TEXT NOT NULL,
      shortcut TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );

    -- Phase 5: Content Queue
    CREATE TABLE IF NOT EXISTS content_queue (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      text TEXT NOT NULL,
      media_urls TEXT,
      community_id TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'queued',
      scheduled_post_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_content_queue_slot_status
      ON content_queue(account_slot, status, position);

    -- Agent Webhooks
    CREATE TABLE IF NOT EXISTS agent_webhooks (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      events TEXT NOT NULL,
      secret TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      failure_count INTEGER NOT NULL DEFAULT 0,
      last_delivered_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_webhooks_active
      ON agent_webhooks(active);

    -- Sprint 1: Events
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      account_slot INTEGER,
      payload TEXT,
      read_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_events_type_created
      ON events(event_type, created_at);
    CREATE INDEX IF NOT EXISTS idx_events_entity
      ON events(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_events_unread
      ON events(read_at, created_at) WHERE read_at IS NULL;

    -- Sprint 1: Webhook Deliveries
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id INTEGER PRIMARY KEY,
      webhook_id INTEGER NOT NULL,
      event_id INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER,
      response_status INTEGER,
      response_body TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook
      ON webhook_deliveries(webhook_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event
      ON webhook_deliveries(event_id);

    -- Sprint 2: Media Library
    CREATE TABLE IF NOT EXISTS media_library (
      id INTEGER PRIMARY KEY,
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      width INTEGER,
      height INTEGER,
      tags TEXT,
      description TEXT,
      used_count INTEGER NOT NULL DEFAULT 0,
      uploaded_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_media_library_mime
      ON media_library(mime_type);
    CREATE INDEX IF NOT EXISTS idx_media_library_uploaded
      ON media_library(uploaded_at);

    -- Sprint 2: Recurring Schedules
    CREATE TABLE IF NOT EXISTS recurring_schedules (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      text TEXT,
      media_library_ids TEXT,
      community_id TEXT,
      frequency TEXT NOT NULL,
      cron_expression TEXT,
      next_run_at INTEGER,
      last_run_at INTEGER,
      times_run INTEGER NOT NULL DEFAULT 0,
      max_runs INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_recurring_schedules_status_next
      ON recurring_schedules(status, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_recurring_schedules_account
      ON recurring_schedules(account_slot, status);

    -- Sprint 2: Content Pool
    CREATE TABLE IF NOT EXISTS content_pool (
      id INTEGER PRIMARY KEY,
      recurring_schedule_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      media_library_ids TEXT,
      used_count INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_content_pool_schedule
      ON content_pool(recurring_schedule_id, used_count);

    -- Sprint 3: Automation Rules
    CREATE TABLE IF NOT EXISTS automation_rules (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL,
      conditions TEXT NOT NULL DEFAULT '[]',
      action_type TEXT NOT NULL,
      action_config TEXT NOT NULL DEFAULT '{}',
      account_slot INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      run_count INTEGER NOT NULL DEFAULT 0,
      last_run_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled
      ON automation_rules(enabled, trigger_type, account_slot);

    CREATE TABLE IF NOT EXISTS automation_rule_runs (
      id INTEGER PRIMARY KEY,
      rule_id INTEGER NOT NULL,
      trigger_type TEXT NOT NULL,
      trigger_source TEXT,
      status TEXT NOT NULL,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_automation_rule_runs_rule
      ON automation_rule_runs(rule_id, created_at);

    -- Sprint 3: RSS Feeds
    CREATE TABLE IF NOT EXISTS feeds (
      id INTEGER PRIMARY KEY,
      url TEXT NOT NULL,
      title TEXT,
      account_slot INTEGER NOT NULL DEFAULT 1,
      check_interval_minutes INTEGER NOT NULL DEFAULT 15,
      last_checked_at INTEGER,
      last_entry_id TEXT,
      auto_schedule INTEGER NOT NULL DEFAULT 0,
      template TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_feeds_status_checked
      ON feeds(status, last_checked_at);

    CREATE TABLE IF NOT EXISTS feed_entries (
      id INTEGER PRIMARY KEY,
      feed_id INTEGER NOT NULL,
      entry_url TEXT NOT NULL,
      entry_title TEXT NOT NULL,
      entry_summary TEXT,
      published_at INTEGER,
      scheduled_post_id INTEGER,
      processed_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_feed_entries_unique
      ON feed_entries(feed_id, entry_url);
    CREATE INDEX IF NOT EXISTS idx_feed_entries_feed_created
      ON feed_entries(feed_id, created_at);

    -- Sprint 3: Saved Searches
    CREATE TABLE IF NOT EXISTS saved_searches (
      id INTEGER PRIMARY KEY,
      keywords TEXT NOT NULL,
      account_slot INTEGER NOT NULL DEFAULT 1,
      check_interval_minutes INTEGER NOT NULL DEFAULT 15,
      last_checked_at INTEGER,
      auto_action TEXT,
      reply_template TEXT,
      notify INTEGER NOT NULL DEFAULT 1,
      language TEXT DEFAULT 'en',
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_saved_searches_status_checked
      ON saved_searches(status, last_checked_at);

    CREATE TABLE IF NOT EXISTS saved_search_matches (
      id INTEGER PRIMARY KEY,
      search_id INTEGER NOT NULL,
      match_id TEXT NOT NULL,
      match_url TEXT NOT NULL,
      match_text TEXT NOT NULL,
      action_status TEXT NOT NULL DEFAULT 'none',
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_search_matches_unique
      ON saved_search_matches(search_id, match_id);
    CREATE INDEX IF NOT EXISTS idx_saved_search_matches_search_created
      ON saved_search_matches(search_id, created_at);

    -- Sprint 4: Short URLs
    CREATE TABLE IF NOT EXISTS short_urls (
      id INTEGER PRIMARY KEY,
      short_code TEXT NOT NULL UNIQUE,
      target_url TEXT NOT NULL,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      click_count INTEGER NOT NULL DEFAULT 0,
      post_id INTEGER,
      created_at INTEGER DEFAULT (unixepoch())
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_short_urls_code
      ON short_urls(short_code);
    CREATE INDEX IF NOT EXISTS idx_short_urls_post
      ON short_urls(post_id);

    CREATE TABLE IF NOT EXISTS url_clicks (
      id INTEGER PRIMARY KEY,
      short_url_id INTEGER NOT NULL,
      referer TEXT,
      user_agent TEXT,
      ip_hash TEXT,
      clicked_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_url_clicks_short_url
      ON url_clicks(short_url_id, clicked_at);

    -- Sprint 4: Follower Snapshots
    CREATE TABLE IF NOT EXISTS follower_snapshots (
      id INTEGER PRIMARY KEY,
      account_slot INTEGER NOT NULL,
      followers_count INTEGER NOT NULL,
      following_count INTEGER NOT NULL,
      snapshot_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_follower_snapshots_slot_time
      ON follower_snapshots(account_slot, snapshot_at);

    -- Sprint 5: Post Approvals
    CREATE TABLE IF NOT EXISTS post_approvals (
      id INTEGER PRIMARY KEY,
      post_id INTEGER NOT NULL,
      requested_by TEXT NOT NULL DEFAULT 'user',
      status TEXT NOT NULL DEFAULT 'pending',
      decision_note TEXT,
      requested_at INTEGER DEFAULT (unixepoch()),
      decided_at INTEGER,
      created_at INTEGER DEFAULT (unixepoch()),
      updated_at INTEGER DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_post_approvals_post
      ON post_approvals(post_id);
    CREATE INDEX IF NOT EXISTS idx_post_approvals_status
      ON post_approvals(status);
  `);


  ensureLegacyColumns(sqlite);
  isInitialized = true;
}
