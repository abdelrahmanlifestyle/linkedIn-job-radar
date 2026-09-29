# Contract: Telegram Messages

**Transport**: `POST https://api.telegram.org/bot<TOKEN>/sendMessage`

```json
{ "chat_id": "<TELEGRAM_CHAT_ID>", "text": "<html>", "parse_mode": "HTML",
  "link_preview_options": { "is_disabled": true } }
```

- **Escaping**: Every value taken from LinkedIn (title, company, location, posted text) is
  HTML-escaped: `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`.
- **Pacing**: About 1.1 s between messages. On a 429, wait `retry_after` seconds once and retry,
  otherwise the send fails (the job becomes DEFERRED).

## Job alert (`job`)

```text
🅰️ <b>{title}</b>
🏢 {company} · 📍 {location}[ ({workType})]
🕒 posted {postedAgo}[  ⚠️ mentions relocation / location restriction]
🔗 {link}
```

Example:

```text
🅰️ Senior Angular Developer
🏢 Acme · 📍 Cairo, Egypt (Hybrid)
🕒 posted 12 minutes ago
🔗 https://www.linkedin.com/jobs/view/4473271098
```

- `({workType})` is left out when `workType` is null. It is also left out when the location
  already contains the work type.
- The ⚠️ part appears only when `relocationWarning` is true (FR-009).

## Digest (`digest`, more than `digestThreshold` new jobs)

```text
🅰️ <b>{N} new Angular jobs</b>
• <a href="{link}">{title}</a> — {company} · {location}[ ⚠️]
• …
```

When the text is longer than 4096 characters, it's split at line boundaries. Every chunk after
the first starts with `(cont.)`.

## First-run summary (`startup`)

```text
📡 <b>Radar started</b> — {N} jobs currently open. You'll get alerts for new ones from now on.
```
