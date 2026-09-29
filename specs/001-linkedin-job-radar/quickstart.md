# Quickstart & Validation: LinkedIn Job Radar

These scenarios show that the feature works end to end. The contracts are in
[contracts/](./contracts/), and entity rules are in [data-model.md](./data-model.md).

## Prerequisites

- Node 24 LTS and npm. `node -v` must report v24. With nvm-windows, run `nvm use 24.21.0`.
- A Telegram bot token and your chat id:
  1. Message **@BotFather** → `/newbot` → copy the token.
  2. Send any message to your new bot.
  3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and copy `message.chat.id`.
- A GitHub account. A public repository is recommended (unlimited free Actions minutes).

## 1. Offline tests (no network)

```powershell
npm ci
npm test
```

**Expected**: all tests pass. They cover card parsing from fixtures, the title rules (including
the lawyer-for-"Angular" case and "Junior Angular Developer"), relocation flags, digest
switching, state pruning, and the rule that only handled jobs are saved.

## 2. Dry run against LinkedIn (no messages, no state)

```powershell
npm run radar -- --dry-run
```

**Expected**:
- Each search logs its page and card counts.
- Every parsed card is printed with its decision (MATCHED, REJECTED or DEFERRED).
- Irrelevant titles are REJECTED.
- The summary shows `requestsUsed ≤ 15`.
- `data/seen.json` is unchanged (check with `git status`) and no Telegram message arrives.

## 3. First real run → single "Radar started" message

```powershell
$env:TELEGRAM_BOT_TOKEN = "<token>"; $env:TELEGRAM_CHAT_ID = "<chat id>"
Remove-Item data/seen.json -ErrorAction SilentlyContinue
npm run radar
```

**Expected**: exactly **one** message on the phone, `📡 Radar started — N jobs currently open`.
`data/seen.json` now has `initializedAt` and N or more ids (US3, SC-006).

## 4. Dedupe and single-alert check

1. Run `npm run radar` again right away. **Expected**: no messages (US1 scenario 2).
2. Delete one *matched* id from `data/seen.json` and run again. **Expected**: exactly one job
   alert for that id, in the [job alert format](./contracts/telegram-messages.md#job-alert-job).
   The id is back in `seen.json`.

## 5. Retry on failure (FR-010a)

Set `$env:TELEGRAM_CHAT_ID = "0"`, delete one matched id from `seen.json`, and run.

**Expected**:
- Exit code 1.
- The id is **not** re-added to `seen.json`.

Restore the correct chat id and run again. **Expected**: that job's alert arrives.

## 6. Config-only tuning (US5)

Add `"engineer"` to `excludeTitleTerms` and run `npm run radar -- --dry-run`.

**Expected**: titles containing "Engineer" now show REJECTED. Revert the change afterwards.

## 7. Cloud deployment (US2)

1. Push the repository to GitHub.
2. Add the repository secrets `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.
3. Go to **Actions → radar → Run workflow**.

**Expected**:
- The run succeeds.
- The log shows the RunSummary.
- If anything changed, a `chore: update seen jobs [skip ci]` commit appears.
- Scheduled runs then show up about every 30 minutes, possibly 5–20 minutes late, while your PC
  is off.

## 8. Account-safety check (SC-004)

```powershell
git grep --untracked -niE "li_at|jsessionid|set-cookie|cookie:|linkedin.*(token|password)" -- src config.json .github
```

**Expected**: no matches. `--untracked` also searches files that aren't committed yet. The search leaves out `tests/`, because the tests deliberately check
that no Cookie header is sent.
