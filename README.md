# voice-chat

Личный Discord для своих: текстовые каналы, голосовые каналы и демонстрация экрана.
Nuxt 4 + @nuxt/ui, LiveKit (SFU), SQLite (Drizzle), файлы в S3-совместимом хранилище.

- Domain glossary: [CONTEXT.md](CONTEXT.md) · Architecture decisions: [docs/adr](docs/adr)
- Production deployment: [docs/DEPLOY.md](docs/DEPLOY.md)

## Development

```bash
bun install
cp .env.example .env   # for dev only NUXT_SESSION_PASSWORD is required; S3 vars enable uploads

# LiveKit (voice) + MinIO (attachments) — the dev server runs on the host (Node),
# these containers only provide the supporting services (see compose.dev.yaml):
docker compose -f compose.dev.yaml up -d
# MinIO bucket (named in NUXT_S3_BUCKET) is auto-created on first run.
# Firefox: voice needs LIVEKIT_NODE_IP=<your LAN IP> in .env (Chrome works without it).

bun run dev            # http://localhost:3000 — first registered account becomes admin
```

The dev server runs on Node (`nuxt dev --host`: Bun's dev proxy drops WebSocket
upgrades, and `--host` lets the LiveKit container deliver webhooks). Production
runs on Bun (`nitro` preset `bun`) — SQLite driver switches automatically
(better-sqlite3 in dev, `bun:sqlite` in prod).

## Scripts

| Command                              | Purpose                                                          |
| ------------------------------------ | ---------------------------------------------------------------- |
| `bun run dev`                        | dev server (Node runtime, all interfaces)                        |
| `bun run build`                      | production build (Bun preset)                                    |
| `bun run db:generate`                | generate a Drizzle migration after editing `server/db/schema.ts` |
| `bun run typecheck` / `lint` / `fmt` | quality gates                                                    |

## Production smoke test (local)

```bash
bun --bun nuxt build
NITRO_PORT=3001 NUXT_DB_PATH=.data/prod-test.sqlite NUXT_MIGRATIONS_DIR=server/db/migrations \
  bun .output/server/index.mjs
```
