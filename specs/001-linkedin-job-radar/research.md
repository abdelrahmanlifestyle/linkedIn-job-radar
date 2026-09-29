# Research: LinkedIn Job Radar

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-29

The main input is [docs/PLAN.md](../../docs/PLAN.md). Everything decided there is taken as settled.
This file covers the open points that planning surfaced, plus the facts that were checked against
the live public endpoints on 2026-09-29. That check was 2 logged-out requests.

## R1. Runtime version

- **Decision**: Use **Node 24 LTS** both locally (24.21.0 is installed) and in CI, and declare
  `"engines": { "node": ">=24" }`. Run TypeScript through **Node's built-in type stripping**:
  `node src/index.ts`. There's no `tsx` and no build step. `typescript` stays as a dev
  dependency for type checking only (`tsc --noEmit`).
- **Rationale**:
  - Node 20, the version in PLAN.md, reached end of life on 2026-04-30.
  - With Node 24 in both places, the built-in TypeScript support removes a runtime tool entirely
    (Constitution V).
- **Required TypeScript settings**: code must use only syntax Node can strip.
  - `erasableSyntaxOnly: true`: no enums, namespaces or parameter properties.
  - `verbatimModuleSyntax: true`: use `import type` for types.
  - `allowImportingTsExtensions: true` and `noEmit: true`: relative imports use `.ts`
    extensions.
- **Local setup**: nvm-windows is switched to the current LTS, 24.21.0 (`nvm install lts` then
  `nvm use 24.21.0`, done on 2026-09-29). `node -v` reports v24.21.0 and npm is 11.19.0.
- **Alternatives considered**:
  - `tsx` as a dev dependency. It was needed only while local Node was 20. Now it's an
    unnecessary extra dependency.
  - A `tsc` build step. Rejected because it adds a build step with no benefit for a script this
    small.

## R2. Test framework

- **Decision**: Use the built-in **`node:test`** and `node:assert`, run with
  `node --test "tests/**/*.test.ts"`. The explicit pattern avoids relying on Node's default test
  file detection.
  Tests use saved HTML fixtures and never make network calls.
- **Rationale**: No extra dependencies (Constitution V), and it meets the constitution's rule
  that tests run against saved samples.
- **Alternatives considered**: Vitest and Jest. Both are fine, but they add dependencies and
  config for about 30 test cases.

## R3. Search result card structure (checked live)

The endpoint `GET https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?...`
returns HTTP 200 with a fragment of `<li>` elements. The first page had 10 cards.

| Field | Selector / source | Notes |
|-------|-------------------|-------|
| Job id | `div.base-card[data-entity-urn]` → `urn:li:jobPosting:<id>` | The only stable key. |
| Title | `h3.base-search-card__title` (trimmed) | |
| Company | `h4.base-search-card__subtitle` (text, trimmed) | Usually wraps an `<a>`. |
| Location | `span.job-search-card__location` | e.g. `Egypt`, `Cairo, Cairo, Egypt`. |
| Posted | `time.job-search-card__listdate[datetime]` + its text | `datetime` is a **date only** (`2026-09-25`). The text is relative (`4 days ago`, `12 minutes ago`). Fresh cards use the class `job-search-card__listdate--new`. |
| Link | `a.base-card__full-link[href]` | Contains a country subdomain and tracking params. Normalized to `https://www.linkedin.com/jobs/view/<id>`. |

- **Decision**: Show the card's **relative time text** as "posted …" in alerts. Keep the date
  (`postedDate`) for logs. Treat `listdate--new` as a sign the card is fresh, for information
  only.
- **Decision**: Normalize every link to `https://www.linkedin.com/jobs/view/<id>`. It's short,
  stable, and has no tracking parameters.

## R4. Work type (on-site / hybrid / remote)

The card has **no work-type field**.

- **Decision**: Work type comes from the search that found the job, with no extra requests:
  - The job appeared in a remote-only search → `Remote`.
  - Otherwise, if the location text contains `(Remote)`, `(Hybrid)` or `(On-site)` → that value.
  - Otherwise, leave it blank. The alert shows just the location.
- **Rationale**: Getting the exact work type would mean one more request per job, which breaks
  the request budget (Constitution II) for a minor display detail. The spec phrase "work type
  where available" (FR-004) allows this.
- **Alternatives considered**:
  - Running each Egypt search three times with `f_WT=1/2/3`. That triples the requests.
  - Reading it from the posting page. It isn't reliably there either.

## R5. Job description (checked live)

The endpoint `GET https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>` returns HTTP 200,
about 57 KB of HTML.

- **Decision**: The description is the text of `.description__text`. A non-empty response with
  no `.description__text` text is a **description anomaly**. The job is DEFERRED, and the run
  records an error (exit 1), because it probably means a layout change (Constitution IV). The criteria list (for
  logging only) is `.description__job-criteria-item` pairs, subheader → text, for example
  "Seniority level → Mid-Senior level".
- **When it's fetched**: Only for **new, unseen** jobs that need it:
  - (a) the title is conditional (frontend-type, FR-006), or
  - (b) the job came from a worldwide remote-only search and its title was accepted, so the
    relocation check (FR-009) can run.
  - Never on the first run (see R8).

## R6. Request budget

Constitution II allows at most about 15 requests per run. A worst-case run looks like this:

| Item | Requests |
|------|----------|
| 4 searches × up to 2 pages | ≤ 8 |
| Description fetches for new candidates | remainder (≥ 7) |

- **Decision**: A single `RequestBudget` (default `maxRequestsPerRun: 15`, set in the config file)
  counts every LinkedIn request, retries included. Searches run first. Description fetches use
  what's left, oldest candidate first. Ties keep config search order, then card order. When the budget runs out, the remaining candidates are
  **deferred**: they stay unseen and are retried next run (FR-010a). The run summary lists them.
- **Retry rule**: Retries after a 429 or 999 response count against the budget. Backoff waits are
  10 s, then 30 s, then the search is skipped.
- **Rationale**: This is a hard cap that holds even if a lot of new jobs appear at once. Nothing
  is lost, only delayed by 30 minutes.

## R7. Title matching semantics

Plain substring matching gets things wrong: `intern` would match `internal` and `international`,
and `php` would match inside words.

- **Decision**: Match terms case-insensitively on **token boundaries**. A term matches when it is
  not preceded or followed by a letter or digit: `(?<![a-z0-9])term(?![a-z0-9])`, with the term
  regex-escaped. Spaces in a term match one or more spaces or hyphens, so `front end` also
  matches `front-end`.
- **Prefix terms**: A term ending in `*` drops the right-hand boundary, so it matches as a
  prefix. `angular*` matches `Angular`, `AngularJS` and `Angular2+`. The ambiguous cases are
  listed explicitly: exclusions contain both `intern` and `internship`, so `Internal Tools` is
  not rejected by mistake.
- **Precedence**: Exclude beats include. Include beats conditional. Anything else is rejected.

## R8. First run and state format

- **Decision**: `data/seen.json` is `{ "version": 1, "initializedAt": ISO, "seen": { "<jobId>":
  ISO } }`. A first run is detected by a **missing file or missing `initializedAt`**, not by an
  empty `seen` map. Otherwise, 30 quiet days of pruning could empty the map and trigger another
  "Radar started" message.
- **First run behavior**: No description fetches. Every job that passes the title rules (include
  or conditional) is recorded as seen. One summary message is sent with the count of
  title-matched jobs. If the summary fails to send, state is **not** saved and the next run is
  still a first run.
- **Missing folder**: `data/` may not exist in a fresh checkout, so create it (recursively)
  before writing. Also commit `data/.gitkeep`.
- **Save strategy**: Write to a temp file, then rename, so a crash can't leave a half-written
  file. Save only in non-dry-run mode, after notifications, and include only the ids that were
  fully handled (FR-010a).

## R9. Telegram delivery

- **Decision**: `POST https://api.telegram.org/bot<token>/sendMessage` with `parse_mode: "HTML"`
  and `link_preview_options: { is_disabled: true }`. Title, company and location are
  HTML-escaped (`& < >`). Messages are sent one at a time, with about 1.1 s between them.
- **On HTTP 429 from Telegram**: honor `parameters.retry_after` once, then treat it as a failure.
- **Digest (> 15 new jobs)**: One line per job (`• <a href="link">Title</a> — Company · Location
  ⚠️`). If it's longer than Telegram's 4096-character limit, split it at line boundaries into as
  few messages as needed. In practice the request budget keeps new jobs per run small, so this
  rarely happens.
- **Rationale**: Mixing Markdown with job titles needs heavy escaping. HTML mode only needs 3
  characters escaped.

## R10. Relocation / location-restriction detection

- **Decision**: These case-insensitive regex patterns live in the config file (`relocationPatterns`):
  - `relocat`
  - `must (?:be )?(?:located|based|resid\w*) in`
  - `(?:located|based) in the (?:us|usa|uk|eu|united states|united kingdom|european union)\b`
  - `\b(?:us|uk|eu)[- ]based (?:only|candidates)`
  - `only (?:open to|accepting) (?:candidates|applicants) (?:from|in)`
- **Where it applies**: Only to jobs found by a worldwide remote-only search. Matches set
  `relocationWarning: true`. The job is still alerted (Constitution III).

## R11. GitHub Actions workflow

- **Decision**:
  - Triggers: `schedule: - cron: '*/30 * * * *'` and `workflow_dispatch`.
  - `concurrency: { group: radar, cancel-in-progress: false }`.
  - `permissions: contents: write`.
  - Steps: `actions/checkout@v7` → `actions/setup-node@v7` (Node 24, `cache: npm`) → `npm ci` →
    `npm run radar`, with secrets from the environment.
  - A final commit step runs with `if: always()`. It commits `data/seen.json` only if it
    changed, using `github-actions[bot]` and the message `chore: update seen jobs [skip ci]`,
    then pushes.
- **Pushing**: `git pull --rebase` before `git push`, with one retry. A push can be rejected when
  the user pushes a config change during a run.
- **Quiet periods**: GitHub turns off scheduled workflows after 60 days without repository
  activity. Commits happen only when `seen.json` changes, which normally means new or pruned
  jobs. A fully quiet period of 60 days is an accepted risk. GitHub emails a warning first, and
  the README explains how to turn it back on (Actions → radar → Enable workflow).
- **Exit codes**: `0` = OK, including skipped searches, which are warnings. `1` = a problem
  someone should look at: a Telegram send failure, a failure to parse cards or a description from
  a non-empty response, a state save failure, or a config or secret error. A failed scheduled run makes GitHub email the owner,
  which gives free failure alerts. The commit step still saves the progress that was made.
- **Rationale**: This follows the PLAN.md decisions. `if: always()` together with only saving
  handled ids meets FR-010a even when a run fails.

## R12. Politeness headers

- **Decision**: One fixed, current desktop Chrome `User-Agent` string, plus
  `Accept-Language: en-US,en;q=0.9` and `Accept: text/html`. No cookies are sent or stored (fetch
  has no cookie jar by default). Delay is `2000 + random() * 3000` ms before every LinkedIn
  request except the first.
- **Rationale**: Covers Constitution I and II. Randomizing user agents is deliberately avoided,
  because an unusual rotating UA looks more suspicious than a steady one.
