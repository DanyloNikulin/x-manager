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

Auto mode does not publish immediately. When X-Manager accepts a drafted result it plans the publish time (`src/lib/worker-publish.ts`): posts take the best-ranked optimal slot (`/api/scheduler/suggest-time` data) that lies inside the slot policy window and at least 90 minutes away from any other scheduled or recently published post of that account; replies go out on the next scheduler tick unless the window is closed, in which case they wait for it to open. The slot policy (`GET/PUT /api/agent/policy`) then has the final say: if the planned time violates the window or a daily/hourly quota, the content is stored as a reviewable draft instead. The planned time and the reason (`optimal-slot`, `next-open-slot`, `reply-immediate`) are recorded under `publication` in the task output and returned as `scheduled_for` / `publish_plan` by `POST /api/agent/tasks/:id/result`.

For defense in depth, an auto reply is scheduled only when its target tweet already exists as an inbound mention for the same account in `engagement_inbox`. Merely setting `reply_kind: inbound` cannot bypass this check; unverifiable replies are downgraded to reviewable drafts.

## Local setup

1. Copy `orchestrator/config.example.toml` to the ignored `orchestrator/config.toml`.
2. Copy each `*.example.md` account file to the same name without `.example`, then complete onboarding. Remove `status: needs-onboarding` only after the profile is usable.
3. Set `X_MANAGER_ADMIN_TOKEN` in the worker process environment. Do not put it in TOML.
4. Run `cargo run --manifest-path orchestrator/Cargo.toml -- --config orchestrator/config.toml doctor`.
5. Run one bounded pass with `cargo run --manifest-path orchestrator/Cargo.toml -- --config orchestrator/config.toml run-once`.

Each pass claims at most two tasks by default. Each task gets at most one writer revision after validator feedback.

## Account profiles (brief and switches in X-Manager)

The brief (`profile`, `voice`, `strategy`, `memory`) and the autopilot switches (`post_mode`, reply modes, `posts_per_day`, `plan_hour`, `plan_timezone`, `language`, `status`) live in X-Manager's `account_profiles` table, one row per slot, and are served by:

- `GET /api/agent/accounts` — all slots with connection state,
- `GET/PUT /api/agent/accounts/:slot` — read or partially update one slot (validated: modes, 0–5 posts per day, hour 0–23, IANA timezone),
- `POST /api/agent/accounts/:slot/import` — one-time seed from the legacy `accounts/slot-N/*.md` files on the host.

The worker resolves each slot through `orchestrator/src/accounts.rs`: a stored profile with status `ready` or `paused` wins; otherwise the legacy `[accounts.N]` TOML block plus the workspace files are used, so the web app and the worker can be upgraded in either order. `paused` means the planner skips the slot and the worker never auto-publishes for it. Audits record which source was used (`account_source`). TOML `[accounts.N]` blocks are optional once profiles exist; `workspace` there is still honoured as the CLI working directory.

## Replies (inbox autopilot)

X-Manager pulls mentions on a timer (`INBOX_SYNC_INTERVAL_SECONDS`, default 900; `DISABLE_INBOX_AUTOPILOT=true` turns it off) for every slot whose stored profile is `ready` and whose X account is connected (`src/lib/inbox-autopilot.ts`). Mentions are read through X API v2 (`GET /2/users/:id/mentions`, the v1.1 `mentions_timeline` endpoint is not available on basic/pay-per-use access) with `since_id` set to the newest stored mention, so each cycle reads and pays for new posts only. New mentions land in the engagement inbox as before; each new inbound mention by someone else (not retweets, not our own posts) becomes a `reply` task in the slot's `Autopilot slot N` campaign with `reply_kind: inbound`, the parent text and URL as untrusted data, and the inbox item is assigned to `subscription-agent` so it is only taken once (at most 10 per cycle, mentions younger than 48 h). The worker writes and validates the reply; `inbound_reply_mode` decides whether it is scheduled on the next tick, waits in Drafts, or stays a draft. The result endpoint still refuses to auto-publish a reply whose target is not an unanswered inbound mention.

### Reply playbook, triage and the depth cap

Two account-layer settings tune the lane (Account console → Brief and Behaviour; `playbook` and `maxRepliesPerConversation` on `GET/PUT /api/agent/accounts/:slot`; `accounts/slot-N/playbook.md` is imported like the other brief files):

- The **reply playbook** is markdown the writer and validator see on reply tasks only (`<reply-playbook>`): the classes of mentions the account gets and, per class, whether to answer, ignore, or escalate; what needs a source; who is never answered. The writer triages first and returns `triage: {class, decision, reason}` next to `variants`. `ignore` means no draft: the worker submits the task with `outcome: "skipped"`, X-Manager marks it `skipped` and dismisses the mention. `escalate` never takes the auto path: with a draft it becomes a task needing review, without one the task waits for the operator with no text. `answer` is the normal path. Posts and threads carry no triage.
- The **depth cap** (`maxRepliesPerConversation`, 1–5, default 2) is enforced by the intake, not by the model: `conversationDepth` in `src/lib/inbox-autopilot-rules.ts` walks from the mention up through our published replies and the mentions they answered, counting our replies in the chain. A mention arriving when the chain already holds that many is left in the inbox with `assigned_to = depth-cap` (visible to a human, never queued), and the count reaches the writer as `exchange_depth` in the task details plus a trusted `REPLY DEPTH` line in the prompt.

## Threads and quotations

The planner may mark a task `format: "thread"` with `max_tweets` (2–8) when a long read deserves a multi-tweet breakdown, and for such tasks its `source_notes` carry up to three short verbatim quotes per source. The writer returns the whole thread in the variant's `tweets` array (first tweet repeated in `text`); each tweet must fit 280 weighted characters, quotations are allowed only verbatim from the source notes, in quotation marks with attribution, and the last tweet carries the source URL. The validator checks every tweet and blocks invented or altered quotations. In auto mode the result endpoint schedules the thread through the thread scheduler (dedupe-keyed on the source URL, so retries are idempotent); otherwise the thread is stored as one draft whose tweets are separated by `---`, and Drafts → Schedule rebuilds it via `POST /api/scheduler/thread`.

## Format skills and length budgets

`skills/x-content-operator/SKILL.md` carries the boundaries every draft obeys. The shape of a draft comes from one of three format skills in `skills/x-content-operator/formats/`: `post.md` (one original post), `thread.md` (a multi-tweet breakdown) and `reply.md`. The worker picks the skill from the task (`reply` tasks use the reply skill; `post` tasks use the thread skill when the planner set `format: "thread"`, otherwise the post skill) and puts its body into both the writer and the validator prompt, next to the account brief. The brief owns voice and diction; the format skill owns shape and length, and says so, because a brief whose sample posts are one-liners otherwise pulls every draft down to that size.

Each format skill owns its character budget in its frontmatter (`max_weighted_chars`, `min_weighted_chars`, weighted as X counts: a URL is 23). The worker measures every draft, the post or every tweet of a thread, against that band (`orchestrator/src/formats.rs`) and folds the result into the validator's verdict: a unit under the floor or over the limit turns a pass into a revise, with the measured numbers in `issues` and `revision_instructions`, so the single revision round fixes length and content together; a block stays a block. A draft still outside the band after that round is handed over for review like any other non-pass. The measurement is recorded under `length` (and the format under `format`) in the task output. Shipped bands: post 200–280, thread 180–280 per tweet, reply 0–280 (a reply is as long as its point). To change a band, edit the frontmatter; the prompt and the check follow, and the `the_shipped_format_skills_are_valid` test keeps the files parseable.

The band is for the argument, not for facts: the post and thread skills define a draft as the account's position (claim, reasoning, at most one figure as evidence, consequence) and carry a position test the validator applies (strip the numbers and names; a position must remain, otherwise revise). The writer opens the source URLs itself when its command allows `WebFetch` (the example config does; everything fetched is untrusted data and only `source_notes[].url` may be fetched), so the planner's notes are orientation and numbers, not a draft.

## Daily planner

Nothing has to create tasks by hand. When an account sets `posts_per_day` (1–5) and the config has a `[planner]` section, every `run-once` pass first runs the planner (`orchestrator/src/planner.rs`), then the worker picks up whatever it queued:

- The planner runs once per account per local day, at or after `worker.plan_hour` in `worker.plan_timezone`. The run is recorded as a marker task (`research`, title `Autopilot <day>: plan`, assigned to `planner`) whose details hold the plan (including the planner's `notes`: what it searched and rejected) or the error, so an empty answer or a failure does not trigger a retry five minutes later — the next attempt is tomorrow. To re-plan the same day, delete or rename that marker task. `x-manager-orchestrator plan` runs only this step.
- Claude reads the account context (`profile`, `voice`, `strategy`, `memory`) plus the account's last 15 posts, may use `WebSearch`/`WebFetch` to find fresh material, and answers with up to `posts_per_day` tasks: topic, angle, pillar and `source_notes` (URLs it actually opened plus the facts the writer may use). Tasks without an http(s) source are rejected. The planner still never sees X credentials and never drafts the post text.
- Accepted tasks land as `post` tasks (`assigned_agent = subscription-agent`) in the active campaign `Autopilot slot <n>`, created on first use. From there the usual writer → validator → publish path applies, including the publication mode and the slot policy window.

## Weekly analyst

With an `[analyst]` section in the config, every `run-once` pass also checks whether the weekly analysis is due (`orchestrator/src/analyst.rs`): from `worker.analyst_weekday` (0 = Monday, default) at `worker.analyst_hour` (default 10) in the account's `plan_timezone`, once per ISO week per ready account; `x-manager-orchestrator analyze` runs it now (`--force` ignores the weekday and hour; the weekly marker still prevents a second run, delete it to re-run). The run:

1. reads the account digest, `GET /api/agent/accounts/:slot/digest?days=7` (`src/lib/digest.ts`): the published posts of the window with the task behind each (topic, angle, pillar, format), the validator's verdict and score, the measured length, metrics at several ages (latest, about 24 h, about 7 d, picked from the hourly collector's readings), replies and mentions, drafts held for review, follower counts, the previous analysis and the current brief;
2. runs the analyst role skill (`skills/x-content-operator/roles/analyst.md`) over it, no tools, JSON-schema output (`schemas/analyst-output.schema.json`): a `report`, `observations` and at most two `proposals`;
3. appends the observations to the stored memory field as a dated `## <day> analyst` section through `POST /api/agent/accounts/:slot/memory` (formatted and written server-side in one immediate transaction, so a concurrent edit of the field is never overwritten; only when the profile is stored in X-Manager, the files fallback cannot be written);
4. records everything in the week's marker task, assigned to `analyst` (`Autopilot <year>-W<week>: analysis`): the marker is reserved *before* the run through the tasks endpoint's `unique_title` create-if-absent (one immediate transaction, 409 when the week is taken), then finished with `waiting_approval` while proposals are open, `done` otherwise, or `failed` with the error (and the analyst's output) when anything after the reservation failed. An existing marker of any status means the week is taken; delete it to run again.

Proposals are decided in the Account console → Proposals (`POST /api/agent/tasks/:id/proposals` with `{ index, action: "apply" | "reject" }`, `src/lib/proposals.ts`). Applying a text proposal replaces the exact `current` text with `proposed` in that brief field (or appends when `current` is empty) and refuses, with 422, when the text is no longer there; applying a setting proposal (`postsPerDay`, `maxRepliesPerConversation`) goes through the normal profile validation and remembers the previous value. Every decision is written back to the task, and the task closes once no proposal is open. The KPI the analyst optimises for follows the strategy: without a funnel, replies from real people and follows per post, never raw impressions.

Do not overlap `run-once` invocations with the same worker ID. This MVP does not yet renew or recover abandoned claim leases automatically; an interrupted task remains visible as `in_progress` for operator recovery. A durable lease/heartbeat is the next reliability step before running a larger worker pool.

## Remote server layout

Run X-Manager, the Rust worker, and the subscription CLIs under the same Linux user. Keep X-Manager on loopback or expose it only through Tailscale; do not publish the admin API directly to the internet. A lightweight desktop session with Chrome is useful only for interactive sign-in to Claude, Codex, X, and other subscribed tools. The worker itself uses their authenticated CLIs and does not automate the browser.

The Settings page contains a host-local login control deck for Claude Code, Codex CLI, and Kimi Code. Codex and Kimi expose device links/codes that can be opened in the operator's browser. Claude subscription OAuth may open Chrome in the server desktop session. X-Manager only supervises the fixed CLI commands and displays sanitized output; credentials remain in each CLI's own storage under the service user's home directory.

The application supports three X account slots, but `config.example.toml` intentionally enables only slots 1 and 2. Each slot has separate profile, voice, strategy, and memory files. Adding another account requires an explicit config entry and completed onboarding rather than silently sharing context.

## Operator views

X-Manager shows the autopilot at three levels:

1. **Overview** (the page you land on): one screen across all slots. For each slot: today's plan and the planner's notes, what is queued and when, what published and its first numbers, and what waits for a human (drafts, tasks needing review). A health strip shows the worker loop, the in-app scheduler, the CLI logins and the X API. Quick actions per slot: pause/resume, re-plan today (forgets the day's planner marker so the next worker pass plans again), open the console. Data: `GET /api/agent/overview`, `POST /api/agent/accounts/:slot/replan`.
2. **Account console** (Accounts): one slot's brief, switches and publishing window, plus its recent activity. `GET/PUT /api/agent/accounts/:slot`.
3. **Orchestrator** (Settings): the machine view. Worker liveness and recent passes parsed from `logs/worker.log`, the planner, writer and validator commands read from `orchestrator/config.toml` (whitelisted keys only, read-only), CLI logins, X API keys and readiness. Data: `GET /api/system/worker?passes=N`. Set `X_MANAGER_WORKER_INTERVAL_SECONDS` when the launcher interval is not 300 s, and `X_MANAGER_REPO_ROOT` when the checkout cannot be found from the server's working directory (the standalone server runs from `.next/standalone`).
