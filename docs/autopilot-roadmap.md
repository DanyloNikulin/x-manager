# Autopilot roles roadmap

**Created:** 2026-09-02
**Scope:** the autopilot for the owner's own accounts (single operator, private project).
The happy path (planner → writer → validator → scheduler, replies from mentions) is proven live;
see `docs/subscription-worker.md`. This document is the plan for the next layer: roles per
account, two prompt layers, and the order in which to build them.

Decisions taken on 2026-09-02:

- One operator. No per-slot access or multi-user work until a second person exists; if the
  project ever opens up, that is a rewrite, not a patch.
- Keep the current architecture. Logic keeps moving into the Rust orchestrator as it grows;
  the web app stays Next.js for now (see "Architecture note" at the end).
- Roles per account: content manager, researcher, writer, validator, analyst, plus a reply
  playbook. The analyst proposes, the operator approves.

---

## Principles

1. **One queue, one audit trail.** Every role rides the existing task → claim → result
   mechanics and writes its audit into the task output. No second pipeline: the consultant
   experiment (file inbox polled by external bots, commit `4b27e4f` on the station) was rolled
   back for exactly this reason.
2. **Two prompt layers, hard line between them.** The *system layer* (repo, git) says what a
   role is and what every draft obeys; the *account layer* (database, Account console) says how
   this account sounds and what it wants. Agents read the system layer and never write it. In the
   account layer they write only dated memory observations and proposals.
3. **Propose, don't drift.** Changes to voice, strategy, cadence and policy are proposals with
   evidence, applied by the operator, versioned, revertible. At most two proposals per analyst
   cycle: seven posts a week is a small sample, and voice erosion is the failure mode.
4. **Outbound engagement is approval-only.** The brief's hard constraints stand: never auto-like,
   auto-follow or reply unsolicited. The researcher may suggest; a human presses the button.
5. **Grow by rings.** Each ring ends with a live run on the station, like the format skills did.

---

## Roles per account

| Role | Cadence | Reads | Writes | Autonomy |
|---|---|---|---|---|
| Content manager (today's planner) | daily, plus when a source fires | brief, pillars, sources, recent posts, researcher radar, analyst notes | post and thread tasks with source notes | auto (publication mode decides) |
| Researcher | a few times a day, budgeted | X search and timelines in the niche, web | radar note for the planner; engagement opportunities as tasks | suggestions only |
| Writer | per task | brief, format skill, task | draft variants | auto |
| Validator | per draft | brief, format skill, measurement | verdict, score, issues | auto |
| Analyst | weekly | the digest: posts, metrics, verdicts, lengths, inbox, what was blocked and why | report; memory observations; proposals | observations auto, proposals approved |

### Content manager

The daily planner is the v0. Growth path: sources (RSS feeds and saved searches already have
tables and processors, both unused), a topic queue balanced across pillars over the week instead
of same-day planning, the researcher's radar as an input, and the analyst's notes on what lands
feeding the pillar weights. It still decides post versus thread and still never drafts text.

### Researcher

Distinct from the analyst on purpose: the analyst looks back at data once a week; the researcher
looks at X now. Its job is to know what the niche is talking about *inside X* today (threads
gaining replies, a take everyone is quoting, a story breaking before it is news) and to turn that
into two outputs:

- a **radar note** the planner reads: topics, angles, what is already saturated;
- **engagement opportunities** as tasks: an outbound reply to a thread worth answering, a quote
  post, a repost suggestion, an account or thread to watch. Every one of them waits for the
  operator; none is automatic.

It runs on a budget (X API search is metered on the current tier), keeps a watchlist in the
account layer, and never drafts the final text itself; the writer does, with the reply or quote
format skill.

### Analyst

Runs weekly on a digest the web app builds. Output in three grades of authority:

- **Observations**, dated, appended to the account memory automatically: "posts that open with a
  number got three times the replies", "threads got no more follows than posts".
- **Proposals**: diffs against the account layer with evidence, expected effect and confidence.
  Targets: a voice line, a strategy pillar weight, posts per day, the reply policy, the post
  versus thread mix, a format band. Shown in the console with the diff; apply or reject.
- **Nothing else.** It never touches system prompts and never publishes.

KPI: the strategy says no funnels, so raw impressions are the wrong target. The analyst optimises
for replies from real people and follows per post, and reports impressions only as context.

### Reply playbook (the lane that is not tuned yet)

Replies exist as plumbing (mention → reply task → writer with the reply format skill → approval)
but no mention has arrived yet, so the lane is untested and has no account-level tuning. The
playbook lives in the account layer and covers:

- **Triage classes** for inbound: question, pushback, agreement, praise, bait, spam, hostile.
  Per class: answer, ignore, or escalate to the operator; the tone; whether a source is needed.
- **Depth cap**: at most two exchanges in one thread, then stop.
- **Outbound**: only what the researcher flagged or the operator asked for; always a suggestion.
- **Who is ignored**: bots, farms, anything the strategy marks as needing review.

The reply format skill (system layer) keeps the shape and the 280 cap; the playbook decides
whether and how. First step is a live test: a mention from the second account, through the
inbox, to a draft, to an approved post.

---

## Prompt layers and where they live

**System layer** (repo, edited by commit, read-only in the Orchestrator view):

- `skills/x-content-operator/SKILL.md`: boundaries every draft obeys.
- `skills/x-content-operator/formats/{post,thread,reply}.md`: shape and character band; a
  `quote.md` joins when quote posts arrive.
- `skills/x-content-operator/roles/{planner,researcher,analyst}.md` (new): what each role is,
  what it may write, its output schema.
- Validator rules (in `worker.rs` today; move to `skills/x-content-operator/validator.md` when
  they change next).

**Account layer** (database, Account console, per slot, versioned):

- the brief: profile, voice, strategy, memory (exists);
- per-role notes (new): planner sources, pillar weights and banned topics; researcher watchlist,
  search terms and daily budget; analyst KPIs and change budget; the reply playbook;
- proposals with before/after text, evidence, status, and the version they were applied as.

---

## Rings, in order

1. **Data and digest.** Metric snapshots at +24 h and +7 d for every autopilot post, tied to the
   task that produced it (the hourly collector exists; it needs the windows and the link). A
   digest endpoint per slot (`days` parameter) that packs posts, metrics, verdicts, length reports,
   revision counts, inbox items and blocked drafts into one JSON. Check on the way: the collector
   filters status `posted`; confirm that is what the scheduler writes.
2. **Analyst v1.** Weekly run in the orchestrator with the analyst role skill; report and memory
   observations automatic; proposals as tasks assigned to `analyst`, waiting for approval; a
   proposals tab in the console with the diff and an apply that writes a new profile version.
3. **Reply playbook and the live reply test.** Playbook fields in the account layer, in the reply
   prompts; one real mention end to end; outbound suggestions plumbing (approval only).
4. **Researcher v1.** Budgeted X search radar; radar note consumed by the planner; opportunities
   as approval tasks; quote posts as a new task type if the X tier allows it.
5. **Content manager v1.** Feeds and saved searches as sources; the weekly topic queue with pillar
   balance; radar and analyst notes in the planner prompt.
6. **Housekeeping.** Role prompts and validator rules as system skills; Overview shows pending
   proposals and the radar; a cost meter (CLI runs and X API calls per day).

Weekly cost at one post a day, for orientation:

| Role | CLI calls per week | X API calls per week |
|---|---|---|
| Content manager | 7 | 0 |
| Writer + validator | 14 to 28 | 0 |
| Analyst | 1 to 2 | 0 |
| Researcher | 7 to 21 | budgeted, e.g. up to 24 searches a day |
| Metrics collector | 0 | 2 per published post |

---

## Architecture note

The web UI feels laggy. Measure before rewriting: client polling intervals, bundle size, the
Tailscale serve path, and SQLite queries under the hourly jobs are the usual suspects, and all
are fixable inside Next.js. Electron would wrap the same web app in Chromium and change none of
that. If the "more Rust" direction is taken later, the natural shape is a Rust backend (the
orchestrator absorbing the scheduler, collector and inbox jobs) with a thin UI on top, Tauri
being the popular way to keep the React screens. Until then, every new role lands in the
orchestrator, so the migration cost only goes down.
