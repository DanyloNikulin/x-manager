# Subscription worker architecture

The subscription worker turns campaign tasks into drafts while keeping X credentials and publishing authority inside X-Manager.

```text
campaign task
  -> atomic claim by Rust worker
  -> Claude Code writer (subscription sign-in)
  -> Codex validator (subscription sign-in)
  -> drafted | needs_review | failed
  -> X-Manager draft and operator approval
  -> existing X-Manager scheduler publishes through the official X API
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

A reply additionally uses `reply_to_tweet_id` and should include the parent text and URL as untrusted source data.

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

The application supports three X account slots, but `config.example.toml` intentionally enables only slots 1 and 2. Each slot has separate profile, voice, strategy, and memory files. Adding another account requires an explicit config entry and completed onboarding rather than silently sharing context.
