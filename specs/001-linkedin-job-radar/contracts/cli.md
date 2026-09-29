# Contract: Command Line & Environment

## Invocation

```text
npm run radar                  # normal run: fetch → filter → notify → save state
npm run radar -- --dry-run     # fetch → filter → print; no Telegram, no state write
npm test                       # offline tests against fixtures (never calls LinkedIn)
```

| Flag | Effect |
|------|--------|
| `--dry-run` | Prints every parsed card (`id \| title \| company \| location \| decision`) and the messages that would be sent. It sends no messages and does not write `data/seen.json`. Telegram secrets are **not** required. The LinkedIn request budget still applies. |
| `--config <path>` | Optional. Defaults to `./config.json`. |
| `--state <path>` | Optional. Defaults to `./data/seen.json`. Useful for testing against a scratch copy. |

## Environment variables

| Name | Required | Notes |
|------|----------|-------|
| `TELEGRAM_BOT_TOKEN` | Yes, except with `--dry-run` | Never logged. It appears in logs only as `***`. |
| `TELEGRAM_CHAT_ID` | Yes, except with `--dry-run` | Numeric chat id. |

Nothing LinkedIn-related is accepted from the environment (Constitution I).

## Output

- **stdout**: Progress lines and a final `RunSummary` block (see
  [data-model.md](../data-model.md)).
- **stderr**: Warnings and errors, prefixed `WARN` or `ERROR`.

## Exit codes

| Code | Meaning | State saved? |
|------|---------|--------------|
| `0` | Run finished. Some searches may have been skipped after a rate-limit (warning only). | Yes: handled ids |
| `1` | Something needs attention. See the list below. | Yes: handled ids only (except for config or state errors) |

Causes of exit code `1`:
- Invalid config.
- Missing secrets (outside dry-run).
- `seen.json` can't be read.
- Any Telegram send failure.
- A LinkedIn response that was not empty but produced 0 parsed cards (probable layout change).
- A job-posting response that was not empty but had no readable description (probable layout
  change). The job stays unseen.
- Saving `data/seen.json` fails.

In CI, exit `1` fails the workflow run. The commit step still runs (`if: always()`), and GitHub
emails the repository owner.
