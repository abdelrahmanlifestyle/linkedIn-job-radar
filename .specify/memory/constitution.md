<!--
Sync Impact Report
- Version change: template (unversioned) → 1.0.0
- Modified principles (all newly defined from template placeholders):
  - [PRINCIPLE_1_NAME] → I. Account Safety (NON-NEGOTIABLE)
  - [PRINCIPLE_2_NAME] → II. Polite, Minimal Footprint on the Source
  - [PRINCIPLE_3_NAME] → III. Signal Over Noise
  - [PRINCIPLE_4_NAME] → IV. Never Silently Lose a Job
  - [PRINCIPLE_5_NAME] → V. Simple, Free, Configurable
- Added sections: Operational Constraints; Development Workflow & Quality Gates
- Removed sections: none
- Templates checked (no edits needed; they read the constitution at runtime):
  ✅ .specify/templates/plan-template.md (Constitution Check gate)
  ✅ .specify/templates/spec-template.md
  ✅ .specify/templates/tasks-template.md
- Follow-up TODOs: none
-->

# LinkedIn Job Radar Constitution

## Core Principles

### I. Account Safety (NON-NEGOTIABLE)

The radar MUST NOT use, request, store, or transmit any LinkedIn account credential, session
cookie, or auth token, and MUST NOT run from the user's home network or devices in production.
It MUST use only publicly accessible, logged-out LinkedIn job listings.

Rationale: The whole reason the project exists is to get job alerts without risking a ban on the
user's LinkedIn account. A feature that needs a login is out of scope, however useful it is.

### II. Polite, Minimal Footprint on the Source

Every run MUST keep traffic to LinkedIn small and human-paced:

- A random 2–5 second delay between requests.
- At most about 15 requests per run.
- A schedule interval of no less than 30 minutes.
- On a rate-limit or block response, back off exponentially with at most 2 retries, then skip
  the search for that run.
- Never retry in a tight loop, and never run parallel requests to LinkedIn.

Rationale: Hitting the source too hard gets the public listings blocked, which ends the project.
Staying under the radar matters more than seeing a job a few minutes sooner.

### III. Signal Over Noise

Alerts MUST be relevant, unique, and few:

- Relevance is decided by the radar's own title and description filters, never by LinkedIn's
  loose keyword matching alone.
- A job id MUST NOT be alerted twice.
- A single run MUST NOT flood the user. First-run summaries and large-batch digests replace
  individual alerts.
- When a match is doubtful (e.g., "remote" with a relocation hint), flag it rather than drop it.

Rationale: Too many alerts, or irrelevant ones, lead the user to mute the bot, and then even the
good matches go unread.

### IV. Never Silently Lose a Job

Handling MUST be at-least-once. A job is recorded as seen only after it has been fully handled:
alerted, or rejected based on data that was read successfully. A failed description fetch or a
failed alert send leaves the job unseen so the next run retries it. A failure in one search MUST
NOT stop the others. A run that parses zero cards from a non-empty response MUST report that as
a problem rather than as "no new jobs".

Rationale: A missed job can't be recovered, and a rare duplicate is the lesser harm. Layout
changes on LinkedIn must be visible, not quietly look like a quiet market.

### V. Simple, Free, Configurable

Keep the moving parts minimal:

- As few runtime dependencies as possible.
- No build step unless justified.
- No database or server, only a small state file saved between runs.
- The system MUST run at $0 within free tiers.

Search terms, locations, seniority, and include/exclude terms MUST live in one settings file that
can be edited without code changes. Any added complexity MUST be justified in the plan's
Complexity Tracking section.

Rationale: This is a personal tool with one user and no operations staff. Every extra part is
something that can break with nobody watching.

## Operational Constraints

- **Secrets**: Messaging credentials come only from environment and CI secrets. They MUST never
  be committed, printed in logs, or included in state files.
- **Committed state**: State saved to the repository MUST hold only job ids and timestamps. No
  personal data and no job descriptions.
- **Unattended operation**: The radar MUST run on a cloud schedule while the user's PC is off,
  support a manual trigger, and prevent overlapping runs.
- **Retention**: Entries in the seen-jobs history expire after 30 days.
- **Observability**: Each run MUST log a short summary: per-search card counts, matches, new
  alerts, skipped searches, and errors. This lets the run history diagnose problems without extra
  tooling.

## Development Workflow & Quality Gates

- **Dry run first**: Every change that affects discovery, filtering, or notification MUST be
  checked with the dry-run mode (no messages sent, no state written) before it is deployed.
- **Tests for filtering and parsing**: Filter rules and job-card parsing MUST have automated tests
  based on saved sample responses, including at least one irrelevant result (e.g., a non-tech job
  returned for "Angular") and one excluded title (e.g., "Junior Angular Developer"). Tests MUST
  NOT call LinkedIn live.
- **Behavior changes go through the spec**: Changes to what gets alerted, how often it runs, or
  request volume MUST update the feature spec before code changes.
- **Plan gate**: `/speckit-plan` MUST pass the Constitution Check against Principles I–V before
  design starts, and again after design.

## Governance

This constitution overrides other project practices when they conflict.

- **Amendments**: Each amendment MUST be recorded in this file with a Sync Impact Report and a
  version bump:
  - MAJOR: a principle is removed or redefined.
  - MINOR: a principle or section is added, or guidance is materially expanded.
  - PATCH: wording or clarifications only.
- **Principle I**: This principle MUST NOT be relaxed by amendment while the project targets
  LinkedIn.
- **Reviews**: Every plan, task list, and code review MUST check compliance with this
  constitution. Any deviation MUST be justified in writing in the plan's Complexity Tracking
  section, or the change is rejected.

**Version**: 1.0.0 | **Ratified**: 2026-09-29 | **Last Amended**: 2026-09-29
