---

description: "Task list for LinkedIn Job Radar"
---

# Tasks: LinkedIn Job Radar

**Input**: Design documents from `specs/001-linkedin-job-radar/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: Included. The constitution's Development Workflow gate requires fixture-based tests for
filtering and parsing, and tests must never call LinkedIn live. Within each story, write the tests
first and check that they fail.

**Organization**: Tasks are grouped by user story, so each story can be built and tested on its
own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: The user story this task belongs to (US1–US6 from spec.md)

## Global implementation rules (apply to every task)

- Node 24, ESM (`"type": "module"`), TypeScript run directly by Node. That means **no enums, no
  namespaces, no constructor parameter properties**, `import type` for types, and relative
  imports ending in `.ts` (research R1).
- Pass all I/O (fetch, sleep, random, clock, file system, Telegram send) as injectable `deps`
  parameters with real defaults, so tests can stub them.
- Never log `TELEGRAM_BOT_TOKEN`. Never send cookies. Never accept LinkedIn credentials
  (Constitution I).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization

- [ ] T001 Create the folders `src/`, `tests/fixtures/`, `data/`, `.github/workflows/` at the repository root. Add an empty `data/.gitkeep` so `data/` exists in fresh checkouts. Run `git init` if the folder isn't already a git repository.
- [ ] T002 Create `package.json` with: `"name": "linkedin-job-radar"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=24" }`, scripts `"radar": "node src/index.ts"`, `"test": "node --test \"tests/**/*.test.ts\""`, `"typecheck": "tsc --noEmit"`.
- [ ] T003 [P] Create `tsconfig.json` with `target: "ES2024"`, `module` and `moduleResolution` set to `"NodeNext"`, `strict: true`, `noEmit: true`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`, `types: ["node"]`, and `include: ["src", "tests"]`.
- [ ] T004 [P] Create `.gitignore` containing `node_modules/`, `data/*.tmp`, `.env`, `.claude/settings.local.json`.
- [ ] T005 [P] Create `config.json` exactly as the "Initial file" in `specs/001-linkedin-job-radar/contracts/config.md`.
- [ ] T006 Install dependencies: `npm install cheerio` and `npm install -D typescript @types/node@24`. This creates `package-lock.json` (depends on T002).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, config loading, sample fixtures, and the polite HTTP layer. Constitution II is non-negotiable, so **every** live request, including the MVP's, must go through the polite layer.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T007 [P] Create `src/types.ts` with string-union and interface types (no enums):
  - `WorkType = "Remote" | "Hybrid" | "On-site"`
  - `Decision = "SKIPPED_SEEN" | "REJECTED" | "MATCHED" | "DEFERRED" | "NOTIFIED"`
  - `Search`, `Config`, `JobPosting` and `SeenState`, with the fields from `specs/001-linkedin-job-radar/data-model.md`
  - `SearchStatus = "ok" | "skipped" | "parse_error"`
  - `RunSummary = { searches: {id, pages, cards, status}[], requestsUsed, matched, notified, rejected, deferred, errors: string[] }`
- [ ] T008 Implement `loadConfig(path)` in `src/config.ts`. It reads the JSON, applies defaults, and throws `ConfigError` naming the field path when a rule is broken. Rules, verbatim from data-model.md:
  - "`searches` 1–8 entries; `id` unique"
  - "`maxPagesPerSearch` 1–5, default `2`"
  - "`maxRequestsPerRun` 1–30, default `15`"
  - "`delayMs` `min ≥ 2000`, `max ≥ min`; default `2000`–`5000`"
  - "`includeTitleTerms` at least 1 entry"
  - "`experienceLevels` subset of 1–6, default `[4,5]`"
  - "`keywords` non-empty"
  - "`postedWithinSeconds` default `86400`"
  - "`digestThreshold` default `15`"
  - "`stateRetentionDays` default `30`"

  Depends on T007.
- [ ] T009 [P] Save the test fixtures in `tests/fixtures/`, making **at most 2 live requests**, 3 s apart. Use the User-Agent and Accept-Language headers from research R12, and send no cookies.
  - `search-page.html`: a response from `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=Angular&geoId=106155005&f_TPR=r604800&f_E=4%2C5&start=0`.
  - `job-posting.html`: a response from `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id of first card>`.
  - Then edit `search-page.html` by hand so that:
    - one card's `h3` reads `Corporate Lawyer`,
    - one card's `h3` reads `Junior Angular Developer`,
    - one card's `h3` reads `Frontend Engineer`,
    - one card uses the `job-search-card__listdate--new` class with the text `12 minutes ago`.
  - Create `search-page-empty.html` as an empty file.
  - Create `search-page-broken.html`: non-empty HTML with no `base-card` elements.
  - Create `job-posting-relocation.html`: a copy of `job-posting.html` whose `.description__text` content includes `Angular` and `Candidates must be located in the US`.
  - Create `job-posting-no-angular.html`: a copy whose description does not mention Angular.
- [ ] T010 [P] Write `tests/linkedin-http.test.ts` for the polite HTTP layer, with stubbed `fetch`, `sleep` and `random`. Check that:
  - `RequestBudget` counts every attempt, retries included, and refuses once `used === max`.
  - Delays fall within `[min, max]` and are skipped before the first request.
  - Requests carry the `User-Agent`, `Accept-Language: en-US,en;q=0.9` and `Accept: text/html` headers and **no `Cookie` header**.
  - A 429 or 999 response retries after 10 s and then 30 s, then returns `rate_limited` (3 attempts in total).
  - An exhausted budget returns `budget_exhausted` without calling fetch.
- [ ] T011 Implement the polite HTTP layer in `src/linkedin.ts`:
  - `class RequestBudget { max; used; tryConsume(): boolean }`, using a plain constructor body with no parameter properties.
  - `politeFetch(url, budget, delayMs, deps)`, returning `{ status: "ok", html } | { status: "rate_limited" } | { status: "budget_exhausted" } | { status: "error", error }` according to research R6 and R12. Use one fixed desktop Chrome User-Agent string.

  Make T010 pass. Depends on T007.

**Checkpoint**: Foundation ready. Types, config, fixtures and polite fetch all work.

---

## Phase 3: User Story 1 - Get a phone alert for each new matching job (Priority: P1) 🎯 MVP

**Goal**: New matching jobs → one Telegram alert each, never repeated.

**Independent Test**: Seed `data/seen.json` with `initializedAt` and some ids, then run. A new matching posting produces exactly one alert (title, company, location/work type, posted age, link). Running again sends nothing.

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [ ] T012 [P] [US1] Write `tests/linkedin-parse.test.ts`, checking that:
  - `parseSearchCards(search-page.html)` returns cards whose `id` is only digits, taken from `data-entity-urn`.
  - `title`, `company` and `location` are trimmed with whitespace collapsed.
  - `postedDate` matches `YYYY-MM-DD` or is null, and `postedAgo` equals `12 minutes ago` for the edited card.
  - `link === "https://www.linkedin.com/jobs/view/<id>"`.
  - The empty fixture gives `[]`.
  - `isParseAnomaly` is true for `search-page-broken.html`.
  - `buildSearchUrl` matches the mapping in `contracts/config.md`: `f_E=4%2C5`, `f_WT=2` only when `remoteOnly`, `f_TPR=r86400`, `start=page*10`.
  - `parseJobDescription(job-posting.html)` returns non-empty text.
  - `isDescriptionAnomaly` is true for non-empty HTML with no `.description__text` (use `search-page-broken.html`) and false for `job-posting.html`.
  - `deriveWorkType` follows research R4.
- [ ] T013 [P] [US1] Write `tests/filter.test.ts`, checking that:
  - `matchTerm("intern", …)` does not match `International Angular Lead` or `Internal Tools`.
  - `"front end"` matches `Front-End Developer`.
  - `"angular*"` matches `AngularJS Developer`.
  - `".net developer"` matches `Senior .NET Developer`.
  - `classifyTitle` returns: `Senior Angular Developer` → `include`, `Junior Angular Developer` → `exclude` (exclude wins), `Frontend Engineer` → `conditional`, `Corporate Lawyer` → `none`.
  - `descriptionMatches` is true when the description contains Angular and false otherwise.
- [ ] T014 [P] [US1] Write `tests/state.test.ts` against a temporary folder. It must cover:
  - A missing file gives `{ firstRun: true, seen: {} }`.
  - A file without `initializedAt` also means first run.
  - Entries older than `stateRetentionDays` are pruned when loading.
  - Invalid JSON throws `StateError` and leaves the file byte-for-byte unchanged.
  - Saving writes keys sorted by id with 2-space indentation, through `seen.json.tmp` and a rename.
  - Saving does not write when the content is unchanged.
  - Saving to `<tmp>/missing-dir/seen.json` creates the missing folder and succeeds.
- [ ] T015 [P] [US1] Write `tests/telegram.test.ts`, checking that:
  - `formatJob` produces exactly the "Job alert" format in `contracts/telegram-messages.md`.
  - `& < >` are escaped in the title, company and location.
  - The ` ({workType})` part is left out when `workType` is null or already appears in the location.
  - `sendMessage` posts `{chat_id, text, parse_mode: "HTML", link_preview_options: {is_disabled: true}}` to `https://api.telegram.org/bot<token>/sendMessage`.
  - On a 429 it waits for `parameters.retry_after` once and retries, then returns `false`.
  - `sendPaced` sleeps at least 1100 ms between messages.
- [ ] T016 [US1] Write `tests/radar.test.ts`, with stubbed `politeFetch` (serving fixtures), `send` and clock, and a state that isn't a first run. It must cover:
  - The same id from 2 searches gives 1 job with both `sources`.
  - An already-seen id is `SKIPPED_SEEN` and doesn't trigger a send.
  - An include title leads to `NOTIFIED`, and its id is in `handledIds`.
  - A conditional title with an Angular description leads to `NOTIFIED`.
  - A conditional title with the `job-posting-no-angular.html` fixture leads to `REJECTED`, and its id is in `handledIds`.
  - A failed description fetch leads to `DEFERRED`, and its id is **not** in `handledIds`.
  - A description response with no readable description (`search-page-broken.html` served as the posting) leads to `DEFERRED`: the id is not in `handledIds`, and `summary.errors` is non-empty.
  - A failed send leads to `DEFERRED`, the id is not in `handledIds`, and a summary error is recorded.
  - `Corporate Lawyer` leads to `REJECTED`.

### Implementation for User Story 1

- [ ] T017 [P] [US1] Add to `src/linkedin.ts`:
  - `buildSearchUrl(search, page)`, following the mapping in contracts/config.md.
  - `parseSearchCards(html)`, using cheerio and the selectors in research R3: `div.base-card[data-entity-urn]`, `h3.base-search-card__title`, `h4.base-search-card__subtitle`, `span.job-search-card__location`, `time.job-search-card__listdate, time.job-search-card__listdate--new`. Normalize the link to `https://www.linkedin.com/jobs/view/<id>`.
  - `isParseAnomaly(html, cards)`: true when the trimmed html is non-empty and there are 0 cards.
  - `parseJobDescription(html)`: the text of `.description__text`, or null.
  - `isDescriptionAnomaly(html, description)`: true when the trimmed html is non-empty and the description is null or empty.
  - `deriveWorkType(search, location)`, following research R4.
  - `runSearch(search, config, budget, deps)`: loops pages `0..maxPagesPerSearch-1`, stops on 0 cards, and returns `{ cards, pages, status }`.

  Make T012 pass.
- [ ] T018 [P] [US1] Implement `src/filter.ts`:
  - `compileTerm(term)`, following research R7: case-insensitive `(?<![a-z0-9])` + the escaped term + `(?![a-z0-9])`. A space in the term matches `[\s-]+`, and a trailing `*` drops the right-hand boundary.
  - `matchTerm`.
  - `classifyTitle(title, config)`, returning `"exclude" | "include" | "conditional" | "none"`, with the precedence exclude > include > conditional.
  - `descriptionMatches(text, config.descriptionRequiredTerms)`.
  - `needsDescription(job, classification)`: returns true for conditional titles.

  Make T013 pass.
- [ ] T019 [P] [US1] Implement `src/state.ts` following `contracts/seen-state.md`:
  - `loadState(path, now, retentionDays)`, returning `{ firstRun, initializedAt, seen }`, pruning old entries, and throwing `StateError` on invalid content.
  - `saveState(path, state)`: creates the parent folder first (`mkdir` with `recursive: true`), writes sorted keys as 2-space JSON to `path + ".tmp"` then renames it, and skips writing when the serialized content hasn't changed.

  Make T014 pass.
- [ ] T020 [P] [US1] Implement `src/telegram.ts`:
  - `escapeHtml`.
  - `formatJob(job)`, following contracts/telegram-messages.md.
  - `sendMessage(token, chatId, html, deps)`, returning `boolean`, handling 429 `retry_after` once, and never logging the token.
  - `sendPaced(messages, sender, deps)`, with ≥1100 ms between sends, returning the result for each message.

  Make T015 pass.
- [ ] T021 [US1] Implement `runRadar({ config, state, now, dryRun }, deps)` in `src/radar.ts`. It follows the decision state machine in data-model.md:
  1. Run the searches in order.
  2. Merge by id, taking the union of `sources`, with first-seen fields winning.
  3. Skip seen ids.
  4. Classify titles.
  5. Fetch descriptions only when needed. A failed fetch means `DEFERRED`. A description anomaly (see `isDescriptionAnomaly`) means `DEFERRED` plus an entry in `summary.errors` naming the job id.
  6. Send job alerts.

  It returns `{ summary: RunSummary, handledIds: string[], jobs }`. Only `REJECTED` and `NOTIFIED` ids go into `handledIds`. Make T016 pass. Depends on T017–T020.
- [ ] T022 [US1] Implement the command-line entry point in `src/index.ts`:
  1. Parse `--config <path>` (default `./config.json`) and `--state <path>` (default `./data/seen.json`).
  2. Require the `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` environment variables, printing an error and exiting 1 if either is missing.
  3. Load config and state, exiting 1 on `ConfigError` or `StateError` without touching the state file.
  4. Call `runRadar`.
  5. Add `handledIds` to `seen` with the current ISO timestamp and save. If saving fails, print an `ERROR` and exit 1.
  6. Print the RunSummary to stdout, and warnings or errors prefixed `WARN` / `ERROR` to stderr.
  7. Exit 1 if `summary.errors` is non-empty, otherwise exit 0 (contracts/cli.md).

**Checkpoint**: US1 works with a pre-seeded state. ⚠️ Don't run live with an empty state until US3 is done, or every open job will be sent as a separate alert.

---

## Phase 4: User Story 2 - Runs by itself without risking my LinkedIn account (Priority: P1)

**Goal**: Unattended cloud runs every 30 minutes that stay polite and resilient, with no LinkedIn credentials anywhere.

**Independent Test**: Push the repository, add secrets, and trigger the workflow. The run succeeds, commits `data/seen.json` if it changed, and scheduled runs keep appearing with the PC off. A stubbed rate-limit on one search doesn't stop the others.

### Tests for User Story 2 ⚠️

- [ ] T023 [US2] Extend `tests/radar.test.ts`, checking that:
  - When one search returns `rate_limited`, the other searches still run, that search's status is `skipped`, a warning is logged, and `summary.errors` stays empty (exit 0).
  - `search-page-broken.html` gives status `parse_error`, and `summary.errors` is non-empty (exit 1).
  - When the budget runs out before all descriptions are fetched, the remaining candidates are `DEFERRED` and not in `handledIds`. The budget goes to the oldest `postedDate` first (null last). Ties keep config search order, then card order.
  - `summary.requestsUsed ≤ config.maxRequestsPerRun`.

### Implementation for User Story 2

- [ ] T024 [US2] Harden `src/radar.ts`:
  - Wrap each search in try/catch so one failure never stops the rest (FR-021).
  - Share a single `RequestBudget(config.maxRequestsPerRun)` across searches and description fetches (research R6).
  - Order description candidates by `postedDate`, oldest first (null last). Ties keep config search order, then card order. Mark them `DEFERRED` once the budget is gone.
  - Record `parse_error`, description anomalies and Telegram failures in `summary.errors`, and `rate_limited` only as a warning.

  Make T023 pass.
- [ ] T025 [P] [US2] Create `.github/workflows/radar.yml` following research R11:
  - Triggers: `on: schedule: - cron: '*/30 * * * *'` and `workflow_dispatch:`.
  - `concurrency: { group: radar, cancel-in-progress: false }` and `permissions: contents: write`.
  - One job on `ubuntu-latest`, with steps:
    1. `actions/checkout@v7`.
    2. `actions/setup-node@v7` with `node-version: 24` and `cache: npm`.

    Use v7, the latest major version of both as of 2026-09-29. Older majors run on the end-of-life Node 20 runtime inside GitHub.
    3. `npm ci`.
    4. `npm run radar`, with `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` from `secrets`.
    5. A commit step with `if: always()`: when `git status --porcelain data/seen.json` is non-empty, set user `github-actions[bot]` / `41898282+github-actions[bot]@users.noreply.github.com`, run `git add data/seen.json` and `git commit -m "chore: update seen jobs [skip ci]"`, then `git pull --rebase && git push`. If the push is rejected, retry `git pull --rebase && git push` once (contracts/seen-state.md).
- [ ] T026 [P] [US2] Write the "Deploy to GitHub" section of `README.md`:
  - A public repository is recommended (unlimited free minutes). A private one fits the 2,000 min/month.
  - Add the secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
  - Actions → radar → Run workflow.
  - Scheduled runs can be 5–20 minutes late.
  - GitHub turns off cron after 60 days without repository activity. The `seen.json` commits normally prevent that, but a fully quiet period (no new or pruned jobs for 60 days) is an accepted risk. GitHub emails a warning first. To turn it back on: Actions → radar → Enable workflow.
  - A failed run emails the owner.

**Checkpoint**: US1 and US2 work. The radar runs unattended and politely.

---

## Phase 5: User Story 3 - No flood on first start or busy days (Priority: P2)

**Goal**: The first run sends one summary message. More than 15 new jobs sends one digest.

**Independent Test**: Delete `data/seen.json` and run. Exactly one `📡 Radar started — N jobs currently open` message arrives, and `seen.json` now has `initializedAt` and N or more ids.

### Tests for User Story 3 ⚠️

- [ ] T027 [P] [US3] Add to `tests/telegram.test.ts`:
  - `formatStartup(n)` matches the contract text exactly.
  - `formatDigest(jobs)` produces the header `🅰️ <b>{N} new Angular jobs</b>` and one line per job, `• <a href="{link}">{title}</a> — {company} · {location}`, with values escaped.
  - Text over 4096 characters is split at line boundaries, and every chunk after the first starts with `(cont.)`.
- [ ] T028 [US3] Add to `tests/radar.test.ts`:
  - A first run (`firstRun: true`) makes **0** description fetches and sends exactly 1 startup message with N = the number of include plus conditional titles. All those ids, plus the rejected ids, are in `handledIds`, and `initializedAt` is returned.
  - A failed startup send returns `saveState: false`.
  - 16 new matches send a digest, 15 send individual messages (`digestThreshold` 15).

### Implementation for User Story 3

- [ ] T029 [P] [US3] Implement `formatStartup(n)` and `formatDigest(jobs)` in `src/telegram.ts`, following contracts/telegram-messages.md, including splitting at 4096 characters. Make T027 pass.
- [ ] T030 [US3] Add the first-run branch to `src/radar.ts`: no description fetches, every title-matched job `NOTIFIED` through the single startup message, and `initializedAt = now` only if the send succeeded. Otherwise return `saveState: false`. Add digest switching when there are more than `config.digestThreshold` new matches. In `src/index.ts`, persist `initializedAt` and skip the save when `saveState` is false. Make T028 pass.

**Checkpoint**: The radar is safe to run live from an empty state.

---

## Phase 6: User Story 4 - Spot remote jobs that are not truly remote for me (Priority: P3)

**Goal**: Worldwide-remote alerts carry ⚠️ when the description mentions relocation or a location restriction. The job is flagged, never dropped.

**Independent Test**: A stubbed worldwide-remote job served with `job-posting-relocation.html` is alerted with the `⚠️ mentions relocation / location restriction` line.

### Tests for User Story 4 ⚠️

- [ ] T031 [P] [US4] Add to `tests/filter.test.ts`: `hasRelocationWarning` is true for the `job-posting-relocation.html` description and for "relocation package provided" and "US-based only", and false for "fully remote, work from anywhere". Invalid patterns are tested in T035.
- [ ] T032 [US4] Add to `tests/radar.test.ts`:
  - A job from `angular-worldwide-remote` with an include title gets its description fetched and `relocationWarning: true`, and the alert text contains ⚠️.
  - The same kind of title from `angular-egypt` only gets **no** description fetch.
  - A digest line for a flagged job ends with ` ⚠️`.

### Implementation for User Story 4

- [ ] T033 [P] [US4] In `src/filter.ts`, add `compileRelocationPatterns(sources)` (case-insensitive `RegExp`) and `hasRelocationWarning(text, patterns)`. Extend `needsDescription` to also return true when the classification is `include` and `job.worldwideRemote` is true. Make T031 pass.
- [ ] T034 [US4] In `src/radar.ts`, set `job.worldwideRemote` when any source search has `remoteOnly === true && geoId === "92000000"`. After a description fetch, set `relocationWarning` for worldwide-remote jobs. Make sure `formatJob` and `formatDigest` in `src/telegram.ts` render the warning. Make T032 pass.

**Checkpoint**: Relocation flags work.

---

## Phase 7: User Story 5 - Tune searches without editing code (Priority: P3)

**Goal**: The user changes behavior only through `config.json`, and mistakes fail clearly before any request is made.

**Independent Test**: Adding `"react only"`-style exclusion terms or a new search to `config.json` changes the next run's behavior without code changes. A typo in a key produces a clear error that names the key.

### Tests for User Story 5 ⚠️

- [ ] T035 [P] [US5] Write `tests/config.test.ts`, checking that:
  - The repository's `config.json` loads, and defaults are applied when optional fields are left out.
  - An unknown top-level key or search key (e.g. `"serches"`) is rejected with the key's path.
  - `delayMs.min: 1000` is rejected.
  - Duplicate search `id` values are rejected.
  - `maxRequestsPerRun: 31` is rejected.
  - An invalid regex in `relocationPatterns` is rejected with the pattern named.
  - Adding `"engineer"` to `excludeTitleTerms` makes `classifyTitle("Angular Engineer")` return `exclude`.

### Implementation for User Story 5

- [ ] T036 [US5] Harden `loadConfig` in `src/config.ts`:
  - Reject unknown keys at the top level, inside `delayMs`, and inside each search.
  - Compile every `relocationPatterns` entry and title term at load time, throwing `ConfigError` with the field path and the offending value.
  - Keep all error messages in plain language.

  Make T035 pass.

**Checkpoint**: Config-only tuning is safe.

---

## Phase 8: User Story 6 - Try it safely before going live (Priority: P3)

**Goal**: A dry-run mode, plus setup documentation a new user can follow in under 30 minutes.

**Independent Test**: `npm run radar -- --dry-run` without Telegram secrets prints every card with its decision and the messages that would be sent. Nothing is sent and `data/seen.json` is unchanged.

### Tests for User Story 6 ⚠️

- [ ] T037 [US6] Add to `tests/radar.test.ts`: with `dryRun: true`, the send stub is never called, `handledIds` are still computed, and the formatted messages are returned for printing.

### Implementation for User Story 6

- [ ] T038 [US6] Add `--dry-run` to `src/index.ts` and `src/radar.ts`:
  - Don't require Telegram secrets.
  - Print every parsed card as `id | title | company | location | decision`, then the texts that would be sent.
  - Never call `saveState`.
  - The LinkedIn request budget still applies.

  Make T037 pass.
- [ ] T039 [US6] Write the "Setup" and "Local usage" sections of `README.md`:
  - Telegram: @BotFather → `/newbot` → token. Message the bot, then read `message.chat.id` from `https://api.telegram.org/bot<TOKEN>/getUpdates`.
  - Node 24 prerequisite (`nvm use 24.21.0`).
  - `npm ci`, `npm test`, `npm run radar -- --dry-run`.
  - Setting `$env:TELEGRAM_BOT_TOKEN` / `$env:TELEGRAM_CHAT_ID` in PowerShell, then `npm run radar`.
  - How to edit `config.json`: a field table linking to the contracts.

**Checkpoint**: All user stories work on their own.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T040 Run `npm run typecheck` and `npm test`, and fix every error until both pass with 0 failures.
- [ ] T041 [P] Run the account-safety grep from `specs/001-linkedin-job-radar/quickstart.md` §8 (it searches `src`, `config.json` and `.github` only) and confirm there are no matches. Confirm that `src/` never sets a `Cookie` header or reads LinkedIn credentials.
- [ ] T042 Run `npm run radar -- --dry-run` against live LinkedIn once (quickstart §2). Confirm that cards parse, irrelevant titles are REJECTED, `requestsUsed ≤ 15`, and `data/seen.json` is unchanged.
- [ ] T043 Run through the rest of `specs/001-linkedin-job-radar/quickstart.md`: §3 first run, §4 dedupe, §5 retry on failure, §6 config tuning, and §7 cloud deployment. Record any gaps as new tasks.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T006 needs T002.
- **Foundational (Phase 2)**: Needs Setup. **Blocks all user stories.**
- **US1 (Phase 3)**: Needs Foundational. It's the core that every other story extends.
- **US2 (Phase 4)**: Needs US1 (`radar.ts` and `index.ts` exist). The workflow file (T025) and README (T026) can start any time after Setup.
- **US3 (Phase 5)**: Needs US1. It's independent of US2.
- **US4 (Phase 6)**: Needs US1. It's independent of US2 and US3.
- **US5 (Phase 7)**: Needs Foundational (`config.ts`) and `filter.ts` from US1.
- **US6 (Phase 8)**: Needs US1.
- **Polish (Phase 9)**: Needs every story you plan to ship.

### Within Each Story

Tests first (they should fail), then implementation, until the tests pass. Tasks that touch the
same file (`src/radar.ts`, `src/telegram.ts`, `tests/radar.test.ts`, `README.md`) run one after
another, in ID order.

### Parallel Opportunities

- **Setup**: T003, T004 and T005 in parallel.
- **Foundational**: T007, T009 and T010 in parallel, then T008 and T011.
- **US1**: tests T012–T015 in parallel. Then implementation T017–T020 in parallel (4 separate files), then T021 and T022.
- **After US1**, US3, US4, US5 and US6 can be worked on in parallel if you watch for same-file edits in `radar.ts` and `telegram.ts`. T025 and T026 have no code dependencies.

---

## Parallel Example: User Story 1

```text
# Tests together:
Task: "T012 tests/linkedin-parse.test.ts"
Task: "T013 tests/filter.test.ts"
Task: "T014 tests/state.test.ts"
Task: "T015 tests/telegram.test.ts"

# Then modules together (different files):
Task: "T017 src/linkedin.ts parsing + runSearch"
Task: "T018 src/filter.ts"
Task: "T019 src/state.ts"
Task: "T020 src/telegram.ts formatJob + send"
```

---

## Implementation Strategy

### MVP (safe to run live)

1. Phase 1 Setup, then Phase 2 Foundational.
2. Phase 3 US1. Validate with the tests and a dry run against a pre-seeded `seen.json`.
3. **Phase 5 US3 before the first live run from an empty state**, to avoid a message flood.
4. Phase 4 US2 to deploy to GitHub Actions. That gives unattended alerts, which is the real MVP.

### Incremental Delivery

After the MVP, add US4 (relocation flags), then US5 (config hardening), then US6 (dry run and
README), then Polish. Each step adds value without breaking earlier ones.

## Notes

- `[P]` means a different file with no incomplete dependencies.
- Commit after each task or logical group, once the git repository exists (T001).
- Don't change `config.json` values while implementing. That file is user-owned (US5).
