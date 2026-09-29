# Contract: `data/seen.json`

The radar writes this file. The CI workflow commits it after every run. It must stay small and
free of personal data: ids and timestamps only (see the constitution section on operational
constraints).

```json
{
  "version": 1,
  "initializedAt": "2026-09-29T10:00:12.345Z",
  "seen": {
    "4470095444": "2026-09-29T10:00:12.345Z",
    "4473235453": "2026-09-29T10:30:40.001Z"
  }
}
```

## Rules

- **File missing** → first run. **`initializedAt` missing** → first run (research R8).
- **Pruning**: At load time, remove entries where `now - seen[id] > stateRetentionDays`.
- **Order**: Keys are written sorted by id, with 2-space indentation, so git diffs stay small and
  deterministic.
- **Writing**: Create the parent folder if it's missing (a fresh CI checkout has no `data/`
  folder until the file is committed). Then write to `seen.json.tmp` and rename it over the
  original. The file is only
  written when its content changed, and never with `--dry-run`.
- **Unreadable or invalid file**: exit 1 and leave the file untouched.
- **What gets added**: Only ids that reached `REJECTED` or `NOTIFIED`
  ([data-model.md](../data-model.md#decision-state-machine-per-job-per-run)).
- **Commit message** in CI: `chore: update seen jobs [skip ci]`.
- **Pushing in CI**: Run `git pull --rebase` before `git push`, and retry the pull and push once
  if the push is rejected. That way a config change pushed during a run doesn't discard the
  history update.
