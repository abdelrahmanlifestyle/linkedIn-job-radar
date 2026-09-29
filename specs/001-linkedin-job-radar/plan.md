# Implementation Plan: LinkedIn Job Radar

**Branch**: `001-linkedin-job-radar` | **Date**: 2026-09-29 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-linkedin-job-radar/spec.md`

## Summary

The radar is a small, scheduled command-line script. Every 30 minutes it runs the configured
LinkedIn searches against the **public logged-out job listing endpoints** (no account, no
cookies). It turns the HTML cards into job records and filters them by title, reading the
description only for ambiguous frontend titles and for worldwide-remote relocation checks. It
drops jobs already recorded in a committed `data/seen.json`, then sends Telegram alerts (single
messages, a digest, or a first-run summary). GitHub Actions hosts it for free, and the workflow
commits the updated history back to the repository. A strict request budget, randomized delays,
and backoff keep traffic well within polite limits. A job counts as seen only after it has been
fully handled, so failures are retried on the next run.

## Technical Context

**Language/Version**: TypeScript 5.x on Node.js 24 LTS, both locally and in CI (`engines: >=24`).
Node's built-in type stripping runs it directly, with no `tsx` and no build step (research R1).

**Primary Dependencies**: `cheerio` for HTML parsing. `typescript` is a dev dependency used only
for type checking. The built-in `fetch` is used for HTTP.

**Storage**: A JSON file, `data/seen.json`, committed by CI (research R8,
[contracts/seen-state.md](./contracts/seen-state.md)).

**Testing**: `node:test` with `node:assert`, run with `node --test "tests/**/*.test.ts"`. It uses saved HTML fixtures
and makes no live requests (research R2).

**Target Platform**: A GitHub Actions `ubuntu-latest` runner on a schedule. Local runs on Windows
(PowerShell) are supported for testing.

**Project Type**: A single-project CLI or scheduled job.

**Performance Goals**: One run finishes in under about 3 minutes, including delays and backoff
(roughly 15 requests × 2–5 s, plus retries). Alerts go out within 60 minutes of posting (SC-001).

**Constraints**:
- At most 15 LinkedIn requests per run, with random 2–5 s delays between them.
- Runs every 30 minutes at most.
- No LinkedIn credentials.
- $0 running cost.
- Telegram messages are at most 4096 characters.

**Scale/Scope**:
- 1 user and 4 searches.
- About 0–20 new jobs per day.
- `seen.json` holds at most a few thousand ids (30-day retention).
- About 8 source files.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate | Pre-research | Post-design |
|-----------|------|--------------|-------------|
| I. Account Safety | No LinkedIn login, cookie or token. Public guest endpoints only. Not run from the home IP in production. | ✅ | ✅ The CLI accepts no LinkedIn inputs ([cli.md](./contracts/cli.md)), fetch has no cookie jar (R12), CI runs in the cloud (R11), and quickstart §8 greps for credentials. |
| II. Polite Footprint | 2–5 s delays, ≤ 15 requests per run, ≥ 30 min interval, bounded backoff, no parallel requests. | ✅ | ✅ `RequestBudget` counts retries too (R6), sequential requests with configurable delays (min floor 2000 ms), cron `*/30`, 429/999 → 10 s / 30 s → skip. |
| III. Signal Over Noise | Own filters decide relevance. No duplicates. No floods. Flag, don't drop. | ✅ | ✅ Token-bounded title rules (R7), seen-state dedupe plus cross-search merge, digest above 15, a single first-run summary, and a relocation flag rather than removal (R10). |
| IV. Never Silently Lose a Job | Mark seen only when handled. Per-search isolation. Zero-card parse is an error. | ✅ | ✅ State machine: only REJECTED and NOTIFIED are saved ([data-model.md](./data-model.md)). A search failure doesn't stop others. A non-empty response with 0 cards, or a job page with no readable description → exit 1 (cli.md). The state folder is created before saving. CI runs `git pull --rebase` before pushing. |
| V. Simple, Free, Configurable | Minimal dependencies, no build, no database or server, $0, one config file. | ✅ | ✅ One runtime dependency (`cheerio`), native Node TypeScript with no `tsx` and no build, a JSON state file, a public repository on the free tier, everything tunable in `config.json` ([config.md](./contracts/config.md)). |
| Ops: Secrets | Secrets from environment or CI only, never logged or committed. | ✅ | ✅ Token masked in logs. `seen.json` holds only ids and timestamps. |
| Ops: Observability | A run summary on every run. | ✅ | ✅ RunSummary ([data-model.md](./data-model.md#runsummary-logged-not-persisted)). |
| Workflow: Tests | Fixture-based tests for parsing and filtering, including an irrelevant result and an excluded title. | ✅ | ✅ `tests/fixtures/` with quickstart §1 scenarios. |
| Workflow: Dry run | Dry-run mode available. | ✅ | ✅ `--dry-run` (cli.md). |

**Result**: PASS. No violations, so Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-linkedin-job-radar/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R1–R12
├── data-model.md        # Phase 1: entities + per-job decision state machine
├── quickstart.md        # Phase 1: validation scenarios
├── contracts/
│   ├── cli.md               # flags, env vars, exit codes
│   ├── config.md            # config.json schema + initial file + URL mapping
│   ├── seen-state.md        # data/seen.json format and write rules
│   └── telegram-messages.md # job / digest / startup message formats
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
package.json              # scripts: radar = "node src/index.ts", test = "node --test \"tests/**/*.test.ts\"",
                          #   typecheck = "tsc --noEmit"
tsconfig.json             # strict, noEmit, NodeNext, erasableSyntaxOnly,
                          #   verbatimModuleSyntax, allowImportingTsExtensions
config.json               # user-editable searches and filter terms (contracts/config.md)
data/
├── .gitkeep              # keeps data/ in fresh checkouts
└── seen.json             # dedupe state, committed by CI (may be absent before first run)
src/
├── index.ts              # CLI entry: parse flags → run → print RunSummary → exit code
├── types.ts              # shared types (Config, Search, JobPosting, Decision, SeenState, RunSummary)
├── config.ts             # load + validate config.json, compile terms/patterns
├── linkedin.ts           # RequestBudget, polite fetch w/ delay + backoff, search URL building,
│                         #   parseSearchCards(html), parseJobDescription(html)
├── filter.ts             # matchTerm (R7), classifyTitle, needsDescription, relocation check
├── state.ts              # load/prune/save seen.json (atomic write, sorted keys)
├── telegram.ts           # formatJob / formatDigest / formatStartup + paced sendMessage
└── radar.ts              # orchestration: searches → merge → decide → notify → handled ids
tests/
├── fixtures/
│   ├── search-page.html          # real sample card list (incl. an irrelevant job)
│   ├── search-page-empty.html
│   └── job-posting.html          # real sample description
├── linkedin.test.ts
├── filter.test.ts
├── state.test.ts
├── telegram.test.ts
└── radar.test.ts         # orchestration with fetch/send stubs (first run, digest, deferrals)
.github/workflows/radar.yml
README.md                 # setup: BotFather, chat id, secrets, manual run (quickstart prereqs)
docs/PLAN.md              # original plan (exists)
```

**Structure Decision**: A single flat project. This follows the file list in PLAN.md, with two
additions:
- **`src/radar.ts`** separates orchestration from the command-line entry point, so the full flow
  can be tested with stubbed fetch and send functions (Constitution workflow gate).
- **`src/config.ts`** puts validation in one place, so a bad config fails before any request is
  made.

## Deviations from docs/PLAN.md

| PLAN.md | This plan | Why |
|---------|-----------|-----|
| Node 20 + `tsx` | Node 24 LTS everywhere, with native TypeScript (no `tsx`) | Node 20 reached end of life on 2026-04-30, and Node 24 runs `.ts` files directly (R1). |
| First run detected by an empty `seen.json` | Detected by `initializedAt` | Prevents a repeat "Radar started" after pruning empties the map (R8). |
| Substring title matching | Token-bounded matching with `*` prefix terms | Stops `intern` from matching "International" (R7). |
| Description fetch only for conditional titles | Also for worldwide-remote include matches | The relocation flag (FR-009) needs the description. Covered by the request budget (R6). |
| Manual verification only | Also automated fixture tests | Constitution workflow gate. |
| "posted 12 minutes ago" from `<time datetime>` | From the card's relative time text | `datetime` is a date only (R3). |

## Complexity Tracking

No violations. Nothing to justify.
