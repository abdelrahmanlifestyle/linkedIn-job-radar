# Data Model: LinkedIn Job Radar

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

All entities live in memory for one run. Only two things persist: **Config**, which the user
edits in `config.json`, and **SeenState**, which the radar writes to `data/seen.json`. Their file
formats are defined in [contracts/](./contracts/).

## Config

Loaded from `config.json` and validated at startup. An invalid config ends the run with exit 1
before any request is made.

| Field | Type | Rules |
|-------|------|-------|
| `searches` | `Search[]` | 1–8 entries. `id` values must be unique. |
| `maxPagesPerSearch` | integer | 1–5, default `2` (FR-003). |
| `maxRequestsPerRun` | integer | 1–30, default `15` (FR-019, Constitution II). |
| `delayMs` | `{ min, max }` | `min ≥ 2000`, `max ≥ min`. Default `2000`–`5000` (FR-018). |
| `includeTitleTerms` | string[] | At least 1 entry. Default `["angular*"]` (FR-005). |
| `conditionalTitleTerms` | string[] | Default `["front-end","frontend","front end","ui engineer","web developer"]` (FR-006). |
| `descriptionRequiredTerms` | string[] | Default `["angular*"]`. A conditional job needs at least one of these in its description. |
| `excludeTitleTerms` | string[] | Default `["junior","intern","internship","trainee","react only","php","wordpress",".net developer"]` (FR-007). |
| `relocationPatterns` | string[] | Case-insensitive regex sources (research R10). Each must compile. |
| `digestThreshold` | integer | Default `15`. More new jobs than this → digest (FR-016). |
| `stateRetentionDays` | integer | Default `30` (FR-011). |

Term matching follows research R7: case-insensitive, token-bounded, with an optional trailing `*`
for prefix matching.

## Search

| Field | Type | Rules |
|-------|------|-------|
| `id` | string | Slug, unique, used in logs, e.g. `angular-egypt`. |
| `keywords` | string | Non-empty. |
| `geoId` | string | LinkedIn geo id. `106155005` = Egypt, `92000000` = Worldwide. |
| `remoteOnly` | boolean | `true` → sends `f_WT=2`. Jobs from this search get `workType = "Remote"`. |
| `experienceLevels` | integer[] | Subset of 1–6. Default `[4,5]` (Mid-Senior, Director). |
| `postedWithinSeconds` | integer | Default `86400` → sends `f_TPR=r86400`. |

A search is **worldwide-remote** when `remoteOnly` is true and `geoId` is `92000000`. Only those
searches trigger the relocation check (FR-009).

## JobPosting

Built from a search card, then enriched step by step.

| Field | Type | Source / rule |
|-------|------|---------------|
| `id` | string (digits) | From `data-entity-urn`. **Identity key.** |
| `title` | string | Card `h3`, whitespace collapsed. |
| `company` | string | Card `h4`. Empty if missing. |
| `location` | string | Card location span. |
| `workType` | `"Remote" \| "Hybrid" \| "On-site" \| null` | Research R4. |
| `postedDate` | `YYYY-MM-DD \| null` | `<time datetime>`. |
| `postedAgo` | string | `<time>` text, e.g. `12 minutes ago`. |
| `link` | URL | `https://www.linkedin.com/jobs/view/<id>`. |
| `sources` | string[] | Ids of every search that returned this job. Filled when duplicates are merged. |
| `worldwideRemote` | boolean | True if any source is a worldwide-remote search. |
| `description` | string \| null | Fetched only when needed (research R5). |
| `relocationWarning` | boolean | Default false. Set by the R10 patterns on worldwide-remote jobs. |
| `decision` | `Decision` | See the state machine below. |

**Merge rule**: The same `id` found by more than one search becomes one `JobPosting`. The union
of its `sources` is kept, and the first-seen card fields win.

### Decision state machine (per job, per run)

```text
            parsed
              │
       ┌──────┴────────── id in SeenState ──────────► SKIPPED_SEEN   (not persisted again)
       ▼
   title check ── exclude term ─────────────────────► REJECTED       (persist as seen)
       │ ── no include/conditional term ────────────► REJECTED       (persist as seen)
       │ ── include term ──┐
       │ ── conditional ───┤
       ▼                   ▼
   needs description? (conditional, or include + worldwideRemote)
       │ no ─────────────────────────────────────────► MATCHED
       │ yes, first run ─────────────────────────────► MATCHED (no fetch; first-run summary)
       │ yes, no budget left ────────────────────────► DEFERRED       (NOT persisted → retried)
       │ yes, fetch failed ──────────────────────────► DEFERRED       (NOT persisted → retried)
       │ yes, page returned but no description ──────► DEFERRED + summary error (layout change → exit 1)
       ▼ yes, fetched
   conditional and no description term ─────────────► REJECTED       (persist as seen)
   otherwise ───────────────────────────────────────► MATCHED (+ relocationWarning if applicable)

   MATCHED ── alert sent (or first run summary sent) ► NOTIFIED       (persist as seen)
   MATCHED ── send failed ───────────────────────────► DEFERRED       (NOT persisted → retried)
```

Only `REJECTED` and `NOTIFIED` are written to SeenState (FR-010a).

Candidates for a description fetch are ordered by `postedDate`, oldest first (null last). Ties
keep search order (as listed in the config), then card order on the page. When the budget runs
out, the rest are DEFERRED.

## SeenState

Persisted in `data/seen.json` ([contracts/seen-state.md](./contracts/seen-state.md)).

| Field | Type | Rules |
|-------|------|-------|
| `version` | `1` | Schema version. |
| `initializedAt` | ISO datetime \| absent | Missing → the run is a **first run** (research R8). Set when the first-run summary is sent successfully. |
| `seen` | map `jobId → ISO datetime` | The time the job was first handled. Entries older than `stateRetentionDays` are removed at the start of each run (FR-011). |

When the file is invalid or unreadable, the run exits with 1 and does not overwrite the file.
This way a corrupted history never turns into a "first run" that throws the history away.

## Alert

| Kind | When | Content |
|------|------|---------|
| `job` | 1 ≤ new matches ≤ `digestThreshold` | One message per job ([contracts/telegram-messages.md](./contracts/telegram-messages.md)). |
| `digest` | new matches > `digestThreshold` | One message listing the jobs, split at 4096 characters if needed. |
| `startup` | first run | `Radar started — N jobs currently open`. |

## RunSummary (logged, not persisted)

`{ searches: [{ id, pages, cards, status: ok|skipped|parse_error }], requestsUsed, matched,
notified, rejected, deferred, errors[] }`. It is printed at the end of every run (constitution
section on observability). Its `errors` array decides the exit code
([contracts/cli.md](./contracts/cli.md)).
