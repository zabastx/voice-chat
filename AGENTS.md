# AGENTS.md — agent quick reference

Private Discord clone for a small friend group: text channels, voice channels, screen share.
**All user-facing UI is in Russian.** Nuxt 4 + @nuxt/ui v4, LiveKit (self-hosted SFU), Postgres 18
(Drizzle), attachments in an external S3-compatible bucket.

New here? Read this file, then [docs/PROGRESS.md](docs/PROGRESS.md) (status) and
[docs/GOTCHAS.md](docs/GOTCHAS.md) (traps that already cost time). Domain terms live in
[CONTEXT.md](CONTEXT.md); the LiveKit decision in [docs/adr/0001](docs/adr/0001-self-hosted-livekit-sfu.md).

**Always check [docs/PROGRESS.md](docs/PROGRESS.md) before starting and update it when you finish.**
It is the single source of truth for what's built, verified, deployed, and still pending. When you
ship a feature, verify something, or change deploy state, edit the relevant row/section in the same
change — a stale PROGRESS.md is a bug.

## Run it

```bash
bun install
# .env needs at least NUXT_SESSION_PASSWORD; S3_* vars enable uploads (see .env.example)
bun run dev            # http://localhost:3000 — FIRST registered account becomes admin
```

The database (Postgres 18), voice (LiveKit), and uploads (MinIO) all come from
`docker compose -f compose.dev.yaml up -d` (see [README.md](README.md) and
[compose.dev.yaml](compose.dev.yaml)). Dev accounts already seeded in the local DB:
`danil` / `password123` (admin), `maks` / `password123`.

## The five things that will bite you

1. **Zod: always `import * as z from 'zod'`.** `import { z }` throws under Vite SSR.
2. **Dev runs on Node, prod on Bun.** `bun run dev` is plain `nuxt dev --host` (Node). Do NOT
   switch dev to the Bun runtime — Bun's dev proxy silently drops WebSocket upgrades and `/_ws`
   hangs (re-verified on Bun 1.3.14 + Nuxt 4.4.8). The DB doesn't care: postgres.js works on
   both runtimes ([server/utils/db.ts](server/utils/db.ts)).
3. **Server error text is Russian, so it goes in `message`, not `statusMessage`.** Non-ASCII HTTP
   reason phrases crash Node. Clients read `err.data.message`.
4. **SSR data fetching uses `useRequestFetch()`, not bare `$fetch`.** `$fetch` doesn't forward the
   session cookie during SSR → empty/anonymous first paint.
5. **LiveKit local dev** needs `--add-host=host.docker.internal:host-gateway` (webhooks reach the
   app) AND `--node-ip 127.0.0.1` as a **CLI flag** (browsers reach RTC media). `node_ip` is not a
   valid config-file key — it crashes the server.

Full list with symptoms in [docs/GOTCHAS.md](docs/GOTCHAS.md).

## Architecture map

- **Realtime** — Nitro WebSocket at `/_ws`, ticket-authed (POST `/api/ws/ticket` → short-lived
  ticket → first WS message `{type:'auth',ticket}`). In-memory hub in
  [server/utils/ws-hub.ts](server/utils/ws-hub.ts). Event types in
  [shared/types/dto.ts](shared/types/dto.ts). Client composable:
  [app/composables/useRealtime.ts](app/composables/useRealtime.ts) (auto-reconnect + `resync`).
- **Voice** — `livekit-client` in the browser ([app/composables/useVoice.ts](app/composables/useVoice.ts),
  dynamic-imported to stay SSR-safe). Server mints JWTs at
  `POST /api/channels/:id/voice-token` (room name = channel id). LiveKit webhooks →
  `POST /api/livekit/webhook` → [server/utils/voice-state.ts](server/utils/voice-state.ts) →
  rebroadcast roster over WS. Mute is relayed app-side via the `voice.self` WS message.
- **Attachments** — external S3 via aws4fetch in [server/utils/storage.ts](server/utils/storage.ts).
  Upload proxied through `POST /api/attachments` (25 MB cap); served via short-lived presigned
  GETs behind a session check at `GET /api/attachments/:id`. Objects deleted with their message;
  orphaned uploads swept on boot in [server/plugins/db.ts](server/plugins/db.ts).
- **Auth** — nuxt-auth-utils sealed cookies. First account = admin, seeds `#general` + `lounge`.
  Everyone else needs a single-use invite. Roles are hierarchical (`admin` > `moderator` > `member`);
  `requireRole(event, min)` in [server/utils/auth.ts](server/utils/auth.ts) authorizes against the
  **DB row**, never the cookie role (see [docs/adr/0002](docs/adr/0002-db-checked-role-guards.md)).
- **DB** — Postgres 18 via postgres.js (`NUXT_DATABASE_URL`), same driver in dev and prod
  (see [docs/adr/0004](docs/adr/0004-postgres-replaces-sqlite.md)). Drizzle schema
  [server/db/schema.ts](server/db/schema.ts); migrations in `server/db/migrations`, applied
  automatically at startup. After editing the schema: `bun run db:generate`. Message search =
  generated `tsvector('russian')` column + GIN index — no triggers, no extra setup.

## Conventions

- Runtime config uses the `NUXT_` env prefix: `NUXT_S3_ENDPOINT` → `runtimeConfig.s3Endpoint`,
  `NUXT_PUBLIC_LIVEKIT_URL` → `runtimeConfig.public.livekitUrl`.
- @nuxt/ui v4 components; use the `nuxt-ui` skill and semantic colors (`text-muted`, `bg-elevated`,
  never raw palette). @click handlers that call `overlay.open()` must be wrapped in a void arrow
  (`@click="() => m.open()"`), or vue-tsc rejects the non-void return.
- Quality gates: `bun run typecheck && bun run lint && bun run fmt`. All must stay green.
- New UI strings: **Russian**. Dates via `ru-RU` locale (see [app/utils/format.ts](app/utils/format.ts)).
- Keep [docs/PROGRESS.md](docs/PROGRESS.md) in sync with reality as part of the same change:
  update the Feature status, Verification matrix, and Remaining work sections whenever you build,
  verify, or deploy something.
- User-facing changes: bump `version` in [package.json](package.json) and prepend a Russian entry
  to [app/data/changelog.ts](app/data/changelog.ts) (newest first) in the same commit — it powers
  the "Что нового" badge/modal.

## Agent skills

### Issue tracker

Issues live as GitHub issues in `zabastx/voice-chat` (use the `gh` CLI); external PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map 1:1 to GitHub labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
