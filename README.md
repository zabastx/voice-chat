# voice-chat

Личный Discord для своих: текстовые каналы, голосовые каналы и демонстрация экрана.
Nuxt 4 + @nuxt/ui, LiveKit (SFU), SQLite (Drizzle), файлы в S3-совместимом хранилище.

- Domain glossary: [CONTEXT.md](CONTEXT.md) · Architecture decisions: [docs/adr](docs/adr)
- Production deployment: [docs/DEPLOY.md](docs/DEPLOY.md)

## Development

```bash
bun install
cp .env.example .env   # for dev only NUXT_SESSION_PASSWORD is required; S3 vars enable uploads

# LiveKit (voice) — required for voice channels:
docker run -d --name voicechat-livekit \
  --add-host=host.docker.internal:host-gateway \
  -p 7880:7880 -p 7881:7881 -p 50100-50120:50100-50120/udp \
  -v ./livekit.dev.yaml:/etc/livekit.yaml \
  livekit/livekit-server --config /etc/livekit.yaml --node-ip 127.0.0.1

# MinIO (attachments) — optional, any S3-compatible endpoint works:
docker run -d --name voicechat-minio -p 9000:9000 \
  -e MINIO_ROOT_USER=minioadmin -e MINIO_ROOT_PASSWORD=minioadmin \
  minio/minio server /data
# then create the bucket named in NUXT_S3_BUCKET

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
