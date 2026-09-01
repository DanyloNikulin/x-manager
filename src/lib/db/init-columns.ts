import type BetterSqlite3 from 'better-sqlite3';
import { canonicalizeUrl, computeDedupeKey, extractFirstUrl, normalizeCopy } from '../scheduler-dedupe';
import { canEncryptSecrets, encryptValue, isEncryptedValue } from '../crypto-store';

type SqliteDb = BetterSqlite3.Database;

const KNOWN_TABLES = new Set([
  'user', 'x_accounts', 'scheduled_posts', 'community_tags', 'system_prompts',
  'topic_search_cache', 'app_settings', 'scheduler_locks', 'engagement_inbox',
  'engagement_actions', 'campaigns', 'campaign_tasks', 'campaign_approvals',
  'api_idempotency', 'agent_runs', 'agent_run_steps', 'scheduled_actions',
  'x_api_calls', 'engagement_cursors', 'inbox_tags', 'inbox_notes',
  'draft_posts', 'post_templates', 'post_metrics', 'saved_replies',
  'content_queue', 'agent_webhooks', 'events', 'webhook_deliveries',
  'media_library', 'recurring_schedules', 'content_pool',
  'automation_rules', 'automation_rule_runs', 'feeds', 'feed_entries',
  'saved_searches', 'saved_search_matches',
  'short_urls', 'url_clicks', 'follower_snapshots',
  'post_approvals',
]);

function hasColumn(sqlite: SqliteDb, tableName: string, columnName: string): boolean {
  if (!KNOWN_TABLES.has(tableName)) {
    throw new Error(`hasColumn called with unknown table: ${tableName}`);
  }
  const rows = sqlite.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return rows.some((row) => row.name === columnName);
}

function ensureColumn(sqlite: SqliteDb, tableName: string, columnName: string, sql: string): void {
  if (!hasColumn(sqlite, tableName, columnName)) {
    sqlite.exec(sql);
  }
}

export function ensureLegacyColumns(sqlite: SqliteDb): void {
  // P1.4: Approval gating columns on campaign_tasks
  ensureColumn(
    sqlite,
    'campaign_tasks',
    'requires_approval',
    'ALTER TABLE campaign_tasks ADD COLUMN requires_approval INTEGER NOT NULL DEFAULT 0',
  );
  ensureColumn(
    sqlite,
    'campaign_tasks',
    'approval_id',
    'ALTER TABLE campaign_tasks ADD COLUMN approval_id INTEGER',
  );
  ensureColumn(
    sqlite,
    'campaign_tasks',
    'claimed_by',
    'ALTER TABLE campaign_tasks ADD COLUMN claimed_by TEXT',
  );
  ensureColumn(
    sqlite,
    'campaign_tasks',
    'claimed_at',
    'ALTER TABLE campaign_tasks ADD COLUMN claimed_at INTEGER',
  );
  ensureColumn(
    sqlite,
    'campaign_tasks',
    'attempt_count',
    'ALTER TABLE campaign_tasks ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0',
  );

  // P3.3: Inbox assignment
  ensureColumn(
    sqlite,
    'engagement_inbox',
    'assigned_to',
    "ALTER TABLE engagement_inbox ADD COLUMN assigned_to TEXT DEFAULT 'unassigned'",
  );

  // Phase 3: Conversation threading
  ensureColumn(
    sqlite,
    'engagement_inbox',
    'in_reply_to_tweet_id',
    'ALTER TABLE engagement_inbox ADD COLUMN in_reply_to_tweet_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'account_slot',
    'ALTER TABLE scheduled_posts ADD COLUMN account_slot INTEGER NOT NULL DEFAULT 1',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'reply_to_tweet_id',
    'ALTER TABLE scheduled_posts ADD COLUMN reply_to_tweet_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'community_id',
    'ALTER TABLE scheduled_posts ADD COLUMN community_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'media_urls',
    'ALTER TABLE scheduled_posts ADD COLUMN media_urls TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'source_url',
    'ALTER TABLE scheduled_posts ADD COLUMN source_url TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'dedupe_key',
    'ALTER TABLE scheduled_posts ADD COLUMN dedupe_key TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'thread_id',
    'ALTER TABLE scheduled_posts ADD COLUMN thread_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'thread_index',
    'ALTER TABLE scheduled_posts ADD COLUMN thread_index INTEGER',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'twitter_post_id',
    'ALTER TABLE scheduled_posts ADD COLUMN twitter_post_id TEXT',
  );

  ensureColumn(
    sqlite,
    'scheduled_posts',
    'error_message',
    'ALTER TABLE scheduled_posts ADD COLUMN error_message TEXT',
  );

  // Sprint 5: Tags on posts
  ensureColumn(
    sqlite,
    'scheduled_posts',
    'tags',
    'ALTER TABLE scheduled_posts ADD COLUMN tags TEXT',
  );

  // Profile enrichment columns on x_accounts
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_profile_image_url',
    'ALTER TABLE x_accounts ADD COLUMN twitter_profile_image_url TEXT',
  );
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_followers_count',
    'ALTER TABLE x_accounts ADD COLUMN twitter_followers_count INTEGER',
  );
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_friends_count',
    'ALTER TABLE x_accounts ADD COLUMN twitter_friends_count INTEGER',
  );
  ensureColumn(
    sqlite,
    'x_accounts',
    'twitter_bio',
    'ALTER TABLE x_accounts ADD COLUMN twitter_bio TEXT',
  );

  sqlite.exec(`
    UPDATE scheduled_posts
    SET account_slot = 1
    WHERE account_slot IS NULL OR account_slot NOT IN (1, 2, 3);

    INSERT INTO x_accounts (
      slot,
      twitter_user_id,
      twitter_username,
      twitter_display_name,
      twitter_access_token,
      twitter_access_token_secret
    )
    SELECT
      1,
      twitter_user_id,
      twitter_username,
      twitter_display_name,
      twitter_access_token,
      twitter_access_token_secret
    FROM user
    WHERE id = 1
      AND twitter_access_token IS NOT NULL
      AND twitter_access_token_secret IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM x_accounts WHERE slot = 1);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_thread
      ON scheduled_posts(thread_id, thread_index);

    CREATE INDEX IF NOT EXISTS idx_scheduled_posts_account_dedupe_key
      ON scheduled_posts(account_slot, dedupe_key);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_posts_account_dedupe_scheduled
      ON scheduled_posts(account_slot, dedupe_key)
      WHERE status = 'scheduled' AND dedupe_key IS NOT NULL;
  `);

  // Clear legacy plaintext tokens from the user table after migration to x_accounts.
  // The migration above copies tokens into x_accounts; keeping them in `user` is unnecessary
  // and leaves plaintext credentials in a table that predates the encrypted credential store.
  try {
    const hasUserTokenCol = hasColumn(sqlite, 'user', 'twitter_access_token');
    if (hasUserTokenCol) {
      const migrated = sqlite.prepare(
        `SELECT 1 FROM x_accounts WHERE slot = 1 AND twitter_access_token IS NOT NULL LIMIT 1`,
      ).get();
      if (migrated) {
        sqlite.prepare(
          `UPDATE user SET twitter_access_token = NULL, twitter_access_token_secret = NULL WHERE twitter_access_token IS NOT NULL`,
        ).run();
      }
    }
  } catch (error) {
    console.error('Schema init warning: failed to clear legacy user table tokens:', error);
  }

  // Backfill source_url + dedupe_key for older rows so dedupe works consistently.
  try {
    const rows = sqlite
      .prepare(
        `SELECT id, account_slot, text, source_url, dedupe_key
         FROM scheduled_posts
         WHERE status = 'scheduled'
           AND (dedupe_key IS NULL OR source_url IS NULL)`,
      )
      .all() as Array<{
      id: number;
      account_slot: number;
      text: string;
      source_url: string | null;
      dedupe_key: string | null;
    }>;

    if (rows.length > 0) {
      const stmt = sqlite.prepare(
        `UPDATE scheduled_posts
         SET source_url = ?, dedupe_key = ?, updated_at = unixepoch()
         WHERE id = ?`,
      );

      for (const row of rows) {
        const urlCandidate = row.source_url || extractFirstUrl(row.text || '');
        const canonicalUrl = urlCandidate ? canonicalizeUrl(urlCandidate) : null;
        const normalizedCopy = normalizeCopy(row.text || '');
        const dedupeKey = canonicalUrl
          ? computeDedupeKey({ accountSlot: row.account_slot, canonicalUrl, normalizedCopy })
          : null;

        stmt.run(canonicalUrl, dedupeKey, row.id);
      }
    }
  } catch (error) {
    console.error('Schema init warning: failed to backfill dedupe fields:', error);
  }

  // Encrypt legacy plaintext credential values where possible.
  if (canEncryptSecrets()) {
    try {
      const migrateRows = sqlite.prepare(
        `SELECT id, setting_key, setting_value
         FROM app_settings
         WHERE setting_key IN ('x_api_key', 'x_api_secret', 'x_bearer_token')`,
      ).all() as Array<{
        id: number;
        setting_key: string;
        setting_value: string;
      }>;

      const updateSetting = sqlite.prepare(
        `UPDATE app_settings
         SET setting_value = ?, updated_at = unixepoch()
         WHERE id = ?`,
      );

      for (const row of migrateRows) {
        if (row.setting_value && !isEncryptedValue(row.setting_value)) {
          updateSetting.run(encryptValue(row.setting_value), row.id);
        }
      }

      const migrateAccounts = sqlite.prepare(
        `SELECT id, twitter_access_token, twitter_access_token_secret
         FROM x_accounts`,
      ).all() as Array<{
        id: number;
        twitter_access_token: string | null;
        twitter_access_token_secret: string | null;
      }>;

      const updateAccount = sqlite.prepare(
        `UPDATE x_accounts
         SET twitter_access_token = ?, twitter_access_token_secret = ?, updated_at = unixepoch()
         WHERE id = ?`,
      );

      for (const row of migrateAccounts) {
        const token = row.twitter_access_token;
        const tokenSecret = row.twitter_access_token_secret;
        if (!token || !tokenSecret) continue;
        if (isEncryptedValue(token) && isEncryptedValue(tokenSecret)) continue;
        updateAccount.run(encryptValue(token), encryptValue(tokenSecret), row.id);
      }
    } catch (error) {
      console.error('Schema init warning: failed to encrypt legacy credential rows:', error);
    }
  }

}
