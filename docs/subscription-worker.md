# Subscription worker architecture

The subscription worker turns campaign tasks into drafts while keeping X credentials and publishing authority inside X-Manager.

```text
campaign task
  -> atomic claim by Rust worker
  -> Claude Code writer (subscription sign-in)
  -> Codex validator (subscription sign-in)
  -> auto-scheduled | drafted | needs_review | failed
  -> existing X-Manager scheduler publishes eligible content through the official X API
```

## Trust boundaries

- X API keys and OAuth tokens are held only by X-Manager.
- The Rust process clears the child environment and restores only a small OS/login-path allow-list before launching Claude or Codex. Metered AI keys and the X-Manager admin token are never inherited, preventing a subscription run from silently turning into usage-based API billing.
- The worker API is protected by the existing `X_MANAGER_ADMIN_TOKEN` middleware.
- Account context is isolated under `accounts/slot-1` and `accounts/slot-2`. Runtime `.md` files are ignored by Git.
- Agents return structured content; they cannot call the publication endpoints.
- The first release handles `post` and `reply` tasks only. Likes, follows, reposts, DMs, and browser automation are outside the worker.

## Task contract

Create an active campaign for the target account slot, then add a task with `assigned_agent` set to `subscription-agent`. The same assignment is enforced again during the atomic claim, so a worker cannot claim a task from another agent queue merely by seeing its ID.

Task details should be a JSON string. A post commonly uses:

```json
{
  "topic": "A concrete subject",
  "angle": "What this account can add",
  "source_notes": [
    { "url": "https://example.com/source", "note": "Relevant verified fact" }
  ]
}
```

A reply additionally uses `reply_to_tweet_id` and should include the parent text and URL as untrusted source data. Set `reply_kind` to `inbound` only when the target user contacted this account first; missing or `outbound` values use the safer outbound policy.

Each account config has three publication controls:

- `post_mode`: defaults to `auto`.
- `inbound_reply_mode`: defaults to `auto`.
- `outbound_reply_mode`: defaults to `approval`.

Allowed values are `auto`, `approval`, and `draft`. Auto mode never gives the model X credentials: the validated result is inserted into X-Manager's existing scheduler, which performs the official X API call. Validator failures and blocks cannot auto-publish.

For defense in depth, an auto reply is scheduled only when its target tweet already exists as an inbound mention for the same account in `engagement_inbox`. Merely setting `reply_kind: inbound` cannot bypass this check; unverifiable replies are downgraded to reviewable drafts.

## Local setup

1. Copy `orchestrator/config.example.toml` to the ignored `orchestrator/config.toml`.
2. Copy each `*.example.md` account file to the same name without `.example`, then complete onboarding. Remove `status: needs-onboarding` only after the profile is usable.
3. Set `X_MANAGER_ADMIN_TOKEN` in the worker process environment. Do not put it in TOML.
4. Run `cargo run --manifest-path orchestrator/Cargo.toml -- --config orchestrator/config.toml doctor`.
5. Run one bounded pass with `cargo run --manifest-path orchestrator/Cargo.toml -- --config orchestrator/config.toml run-once`.

Each pass claims at most two tasks by default. Each task gets at most one writer revision after validator feedback.

Do not overlap `run-once` invocations with the same worker ID. This MVP does not yet renew or recover abandoned claim leases automatically; an interrupted task remains visible as `in_progress` for operator recovery. A durable lease/heartbeat is the next reliability step before running a larger worker pool.

## Remote server layout

Run X-Manager, the Rust worker, and the subscription CLIs under the same Linux user. Keep X-Manager on loopback or expose it only through Tailscale; do not publish the admin API directly to the internet. A lightweight desktop session with Chrome is useful only for interactive sign-in to Claude, Codex, X, and other subscribed tools. The worker itself uses their authenticated CLIs and does not automate the browser.

The Settings page contains a host-local login control deck for Claude Code, Codex CLI, and Kimi Code. Codex and Kimi expose device links/codes that can be opened in the operator's browser. Claude subscription OAuth may open Chrome in the server desktop session. X-Manager only supervises the fixed CLI commands and displays sanitized output; credentials remain in each CLI's own storage under the service user's home directory.

The application supports three X account slots, but `config.example.toml` intentionally enables only slots 1 and 2. Each slot has separate profile, voice, strategy, and memory files. Adding another account requires an explicit config entry and completed onboarding rather than silently sharing context.
