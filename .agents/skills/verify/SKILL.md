---
name: verify
description: Verify a voice-chat change end-to-end — launch the dev stack, drive the app with two Playwright browsers, capture evidence. Use when confirming a feature/fix works in the running app.
---

# Verifying voice-chat changes

## Launch

```bash
docker compose -f compose.dev.yaml up -d   # postgres :5532, minio :9100, livekit :7880
bun run dev                                # Node dev server; PORT=3001 to pick a port
```

- `.env` must have `NUXT_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5532/voicechat`
  and `NUXT_S3_ENDPOINT=http://127.0.0.1:9100` (compose maps non-default host ports because
  other projects squat 5432/9000).
- **Port 3000 may be held by VSCodium's port-forward proxy** (it serves a stale/WSL server).
  Don't trust what answers on 3000 — start your own server on 3001 and verify against that.
- Dev accounts: `danil` / `password123` (admin), `maks` / `password123`. DB console:
  `docker exec voicechat-postgres psql -U postgres -d voicechat`.

## Drive (playwright-cli)

Two sessions for realtime tests: `playwright-cli -s=danil open http://localhost:3001` and
`-s=maks …`. Gotchas that cost time:

- **Login form needs hydration**: fill/click right after `open` silently no-ops (page stays on
  /login with empty form). Wait ~2s after load, then fill refs and click; confirm with
  `--raw eval "() => location.pathname"`.
- **Aria snapshots hide UIcon** (`aria-hidden` spans) — a missing icon in `snapshot` output
  proves nothing. Check the DOM: `--raw eval "() => !!document.querySelector('button ... [class*=telegram]')"`,
  or screenshot.
- Members panel: offline members hidden by default — click «Показать не в сети» (persists in
  localStorage). `#members` is not a DOM id; find rows via `document.querySelectorAll('button')`
  + textContent.
- Call authed APIs as a user from their browser session: `--raw eval "async () => fetch('/api/…')…"` —
  much easier than cookie juggling in PowerShell.
- Attachment 502s in console = S3 endpoint mismatch, usually pre-existing env noise, not your bug.

## Restore

Undo any direct SQL you ran (e.g. `telegram_chat_id`), close sessions
(`playwright-cli -s=… close`), delete snapshot/screenshot scratch files from the repo dir.
