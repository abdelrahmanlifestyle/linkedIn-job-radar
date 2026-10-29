# LinkedIn Job Radar

Sends a Telegram message when a new senior Angular job appears on LinkedIn, in Egypt or as a
worldwide remote role.

- It reads only LinkedIn's **public, logged-out** job listings. No LinkedIn account, login or
  cookies are used.
- It runs on **GitHub Actions every 30 minutes**, so your PC can stay off.
- Alerts go to a private Telegram chat through your own bot.

## How it works

1. **Search**: runs each search in `config.json` (keywords + location + seniority, posted in the
   last 24 h) against LinkedIn's guest job API. Up to 2 pages per search.
2. **Title filter**: rejects excluded titles (e.g. "Junior", "PHP"). Accepts titles containing
   "Angular". Frontend-type titles ("Frontend", "UI Engineer", ...) go to step 3.
3. **Description check**: for frontend-type titles, fetches the job description and keeps the
   job only if it mentions Angular.
4. **Dedupe**: skips job ids already in `data/seen.json`. Entries older than 30 days are pruned.
5. **Alert**: one Telegram message per new job.
   - The **first run** sends a single `📡 Radar started — N jobs currently open` message instead
     and marks those jobs as seen, so you are not flooded.
   - More than **15** new jobs in one run → one **digest** message with links.
   - On worldwide-remote searches, a job whose description mentions relocation or a location
     restriction gets a **⚠️** flag. It is flagged, not dropped.

After each run, the workflow commits the updated `data/seen.json` (job ids and timestamps only).

## Setup

### Node 24

The code is TypeScript run directly by Node 24 (`node src/index.ts`, no build step).

```powershell
nvm install lts
nvm use 24.21.0
node -v   # must print v24.x
```

### Telegram bot and chat id

1. In Telegram, message **@BotFather** → `/newbot` → follow the prompts → copy the **token**.
2. Send any message to your new bot (it can't message you until you do).
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` in a browser and copy
   `message.chat.id` (a number).

Keep the token secret: anyone with it can send messages as your bot.

## Local usage

All commands are PowerShell, from the repository root.

```powershell
npm ci                       # install dependencies
npm test                     # offline tests against fixtures; never calls LinkedIn
npm run radar -- --dry-run   # real LinkedIn fetch; prints decisions, sends nothing, saves nothing
```

A real run needs the Telegram secrets:

```powershell
$env:TELEGRAM_BOT_TOKEN = "<token>"
$env:TELEGRAM_CHAT_ID   = "<chat id>"
npm run radar
```

| Flag | Effect |
|------|--------|
| `--dry-run` | Prints every parsed card (`id \| title \| company \| location \| decision`) and the messages that would be sent. No Telegram, no write to `data/seen.json`, secrets not needed. The request limit still applies. |
| `--config <path>` | Config file. Default `./config.json`. |
| `--state <path>` | State file. Default `./data/seen.json`. Handy for testing against a scratch copy. |

Output: progress and a final run summary on stdout; `WARN` / `ERROR` lines on stderr. The token
is never logged (it shows as `***`).

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Run finished. Some searches may have been skipped because of a rate limit (warning only). |
| `1` | Something needs attention. See [Troubleshooting](#troubleshooting). Jobs that were handled are still saved; jobs that failed stay unseen and are retried next run. |

## Configuration

`config.json` is the only file you edit to tune the radar. Unknown keys are rejected (so typos
fail loudly), and an invalid config stops the run with exit 1 before any request is made. Full
rules: [contracts/config.md](specs/001-linkedin-job-radar/contracts/config.md) and
[data-model.md](specs/001-linkedin-job-radar/data-model.md#config).

| Field | Meaning | Default |
|-------|---------|---------|
| `searches` | 1–8 LinkedIn searches (see next table). | 4 searches: Angular / Frontend in Egypt, Angular / Frontend Angular worldwide remote |
| `maxPagesPerSearch` | Result pages (10 cards each) per search, 1–5. | `2` |
| `maxRequestsPerRun` | Hard cap on LinkedIn requests per run (searches + descriptions), 1–30. | `15` |
| `delayMs` | Random delay between LinkedIn requests. `min` ≥ 2000, `max` ≥ `min`. | `{ "min": 2000, "max": 5000 }` |
| `digestThreshold` | More new jobs than this in one run → one digest message. | `15` |
| `stateRetentionDays` | Days a job id stays in `data/seen.json`. | `30` |
| `includeTitleTerms` | A title with any of these is a match. At least 1 entry. | `["angular*"]` |
| `conditionalTitleTerms` | A title with any of these matches only if the description contains a `descriptionRequiredTerms` term. | `["front-end", "frontend", "front end", "ui engineer", "web developer"]` |
| `descriptionRequiredTerms` | Terms a conditional job's description must contain. | `["angular*"]` |
| `excludeTitleTerms` | A title with any of these is rejected. | `["junior", "intern", "internship", "trainee", "react only", "php", "wordpress", ".net developer"]` |
| `relocationPatterns` | Case-insensitive regexes checked against descriptions of worldwide-remote jobs; a hit adds the ⚠️ flag. Each must compile. | 5 patterns (relocation, "must be located in", "US-based only", ...) |

Each entry in `searches`:

| Field | Meaning | Default in `config.json` |
|-------|---------|---------|
| `id` | Unique slug used in logs, e.g. `angular-egypt`. | — |
| `keywords` | LinkedIn search keywords. | `Angular`, `Frontend`, `Frontend Angular` |
| `geoId` | LinkedIn location id: `106155005` = Egypt, `92000000` = Worldwide. | — |
| `remoteOnly` | `true` → remote jobs only. With `geoId` `92000000` this is a "worldwide-remote" search, which enables the relocation check. | — |
| `experienceLevels` | LinkedIn seniority ids (1–6): `4` = Mid-Senior, `5` = Director. LinkedIn has no "Lead" level; lead roles are usually Mid-Senior. | `[4, 5]` |
| `postedWithinSeconds` | Only jobs posted within this window. | `86400` (24 h) |

**Term matching rules** (title and description terms):

- Case-insensitive, **whole words only**: `intern` does not match "Internal"; `php` does not match
  inside another word.
- A trailing `*` makes it a **prefix** match: `angular*` matches "Angular", "AngularJS",
  "Angular2+".
- A space in a term also matches a hyphen: `front end` matches "Front-End".
- **Exclude beats include**, and include beats conditional. Anything else is rejected.

Test a change safely with `npm run radar -- --dry-run` before pushing it.

## Deploy to GitHub

1. Create a GitHub repository and push this project.
   - **Public is recommended**: Actions minutes are unlimited, secrets stay private, and
     `data/seen.json` holds only job ids.
   - **Private also works**: ~1,440 runs/month × ~1 min fits the free 2,000 min/month.
2. Add the secrets: **Settings → Secrets and variables → Actions → New repository secret**:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
3. Test it: **Actions → radar → Run workflow**. The log shows the run summary, and a
   `chore: update seen jobs [skip ci]` commit appears if anything changed. The first run sends
   the "Radar started" message.

Things to know:

- **Schedule delays**: GitHub's cron often starts runs 5–20 minutes late. The 24-hour search
  window plus the seen-jobs history covers late or skipped runs.
- **60-day inactivity**: GitHub disables scheduled workflows after 60 days without repository
  activity. The `seen.json` commits normally keep the repo active, but a fully quiet period (no
  new or pruned jobs for 60 days) is an accepted risk. GitHub emails a warning first. To turn it
  back on: **Actions → radar → Enable workflow**.
- **Failures**: a failed run (exit 1) fails the workflow, and GitHub emails the repository owner.
  `data/seen.json` is still committed for the jobs that were handled.
- Runs never overlap (`concurrency: radar`). If you push a config change during a run, the commit
  step rebases onto it and retries the push once.

## Troubleshooting

A run exits with code 1 when something needs attention. Check the `ERROR` lines in the log:

| Cause | What to do |
|-------|-----------|
| **LinkedIn layout change**: a non-empty response parsed to 0 cards, or a job page had no readable description. | The HTML selectors in the scraper need updating. Affected jobs stay unseen and will alert once fixed. |
| **Telegram send failure** | Check the token and chat id (secrets or `$env:` values), and that you messaged the bot first. Failed jobs stay unseen and are retried next run. |
| **Invalid config** | The error names the field. Fix `config.json` and verify with `--dry-run`. |
| **Missing secrets** (not in dry-run) | Set `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`. |
| **`data/seen.json` unreadable or can't be saved** | Fix or delete the file. Deleting it makes the next run a first run (one "Radar started" message). |

**Rate limits are not failures.** If LinkedIn answers with 429/999, the radar backs off, skips that
search for this run, logs a `WARN`, and exits 0. The next run (30 min later) tries again.

## Account safety

- No LinkedIn login, account, cookies or tokens. Only the public guest endpoints a logged-out
  browser uses. Nothing LinkedIn-related is read from the environment.
- Polite limits: at most **15 requests per run**, a random **2–5 s delay** between requests,
  exponential backoff on rate limits, then skip. Runs every 30 minutes, not more often.
