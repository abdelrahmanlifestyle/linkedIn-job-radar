# LinkedIn Job Radar — Plan

## Context
Abdelrahman (Lead Angular Developer, 10+ yrs, Cairo) wants phone alerts when new matching LinkedIn jobs are posted, **without using his LinkedIn account/token** (to avoid a ban). The workspace `c:\workspace\linkedIn job radar` is empty — greenfield.

Confirmed decisions:
- **Source:** LinkedIn public guest endpoint (verified working, no login):
  `https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search?keywords=…&geoId=…&f_TPR=…&f_WT=…&f_E=…&start=0`
  Returns HTML `<li>` cards (title `h3`, company `h4`, location, `<time datetime>`, link, `data-entity-urn="urn:li:jobPosting:<id>"`). Keyword matching is loose (an "Angular" search returned lawyer jobs), so **title filtering is mandatory**.
- **Notifications:** Telegram bot.
- **Hosting:** GitHub Actions cron (cloud, PC can be off, not your home IP).
- **Locations:** Egypt (on-site/hybrid/remote) + Worldwide **remote only** (no relocation).
- **Seniority:** Mid-Senior (`f_E=4`) + Director (`f_E=5`) — LinkedIn has no separate "Lead" level; "Lead" titles are usually tagged Mid-Senior.

## Stack
Node 20 + TypeScript (run with `tsx`, no build step) — familiar to an Angular dev. Deps: `cheerio` (HTML parsing). Native `fetch`. No LinkedIn cookies anywhere.

## Files
**Step 0:** copy this plan to `docs/PLAN.md` inside the repo.
```
docs/PLAN.md            copy of this plan
package.json            scripts: "radar": "tsx src/index.ts"
tsconfig.json
config.json             searches, include/exclude keywords (editable without code changes)
src/index.ts            orchestrates: run searches → filter → dedupe → notify → save state
src/linkedin.ts         guest-API fetch + cheerio parsing + optional job-description fetch
src/filter.ts           title/description matching rules
src/telegram.ts         sendMessage via Bot API (HTML parse mode)
src/state.ts            load/save data/seen.json (jobId → firstSeen ISO), prune > 30 days
data/seen.json          dedupe state, committed back by the workflow
.github/workflows/radar.yml
README.md               setup steps (BotFather, chat id, GitHub secrets)
```

## config.json (initial)
Searches (each with `f_TPR=r86400` — last 24h; dedupe prevents repeats; 24h window tolerates GitHub cron delays):
1. `keywords=Angular`, `geoId=106155005` (Egypt), `f_E=4,5`, all work types
2. `keywords=Frontend`, Egypt, `f_E=4,5`
3. `keywords=Angular`, `geoId=92000000` (Worldwide), `f_WT=2` (remote), `f_E=4,5`
4. `keywords=Frontend Angular`, Worldwide, `f_WT=2`, `f_E=4,5`

Pages: up to 2 pages per search (`start=0,10`… stop when a page returns 0 cards).

Filter rules (`filter.ts`):
- **Accept** if title contains `angular`.
- **Accept (conditional)** if title contains `front-end|frontend|front end|ui engineer|web developer` → fetch description from `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/<id>` and accept only if it mentions `angular`. Only done for new, unseen IDs → very few extra requests.
- **Reject** titles with `junior|intern|trainee|react only|php|wordpress|.net developer` (list in config).
- Worldwide-remote results: tag with ⚠️ if description mentions `relocat` or `must be located in|based in the (US|UK|EU)` so you can skip quickly (not dropped, to avoid missing real remote roles).

## Anti-ban / politeness (`linkedin.ts`)
- No auth, no cookies; realistic desktop `User-Agent` + `Accept-Language`.
- 2–5 s random delay between requests; ≤ ~15 requests per run.
- On 429/999: exponential backoff (2 retries), then skip that search for this run — never hammer.
- Runs every 30 min (not more often).

## Notifications (`telegram.ts`)
One message per new job:
```
🅰️ Senior Angular Developer
🏢 Company · 📍 Cairo, Egypt (Hybrid)
🕒 posted 12 minutes ago  [⚠️ mentions relocation]
🔗 https://www.linkedin.com/jobs/view/4473271098
```
Throttle ~1 msg/sec; if > 15 new jobs in a run, send a single digest message instead.
Secrets from env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

## State & first run
- `data/seen.json` holds seen job IDs; entries older than 30 days pruned.
- **First run (seen.json empty):** mark all current matches as seen and send one "Radar started — N jobs currently open" summary, to avoid a flood.

## GitHub Actions (`radar.yml`)
- `on: schedule: cron '*/30 * * * *'` + `workflow_dispatch` (manual run button).
- Steps: checkout → setup-node 20 (npm cache) → `npm ci` → `npm run radar` → commit `data/seen.json` if changed (`git commit -m "chore: update seen jobs [skip ci]"`, `permissions: contents: write`).
- `concurrency: radar` to prevent overlapping runs.
- Recommend a **public repo** (unlimited free minutes; secrets stay private, seen.json is just IDs). Private repo also fits the 2,000 free min/month at a 30-min interval (~1,440 runs × ~1 min).
- Note: GitHub scheduled runs can be delayed 5–20 min; GitHub disables cron after 60 days of no repo activity — the seen.json commits keep it active.

## Setup (README)
1. Telegram: message @BotFather → `/newbot` → token. Send any message to the bot, open `https://api.telegram.org/bot<TOKEN>/getUpdates` → copy `chat.id`.
2. Create GitHub repo, push the project, add secrets `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
3. Actions tab → "Run workflow" to test.

## Verification
1. Locally: `npm i`, set env vars in PowerShell, `npm run radar -- --dry-run` → prints parsed/filtered jobs to console without sending or saving; confirm cards parse (title/company/location/id) and non-Angular jobs are filtered out.
2. `npm run radar` with real Telegram secrets → receive the "Radar started" summary on phone.
3. Delete one ID from `seen.json`, rerun → receive exactly that one job alert (dedupe works).
4. Push to GitHub, trigger `workflow_dispatch`, confirm the run succeeds and commits `seen.json`.
