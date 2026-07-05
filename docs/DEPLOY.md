# Deploy (VPS + docker compose)

## Prerequisites

- A VPS with docker + docker compose plugin installed.
- Two DNS A records pointing at the VPS IP: `{DOMAIN}` and `livekit.{DOMAIN}`.
- S3-compatible bucket credentials from your hosting provider.

## Firewall

Open exactly these ports (example for ufw):

```bash
ufw allow 80/tcp    # HTTP (Let's Encrypt + redirect)
ufw allow 443/tcp   # HTTPS + WSS
ufw allow 443/udp   # HTTP/3 (optional)
ufw allow 7881/tcp  # LiveKit RTC over TCP (fallback when UDP is blocked)
ufw allow 3478/udp  # LiveKit built-in TURN (Firefox + clients behind symmetric NAT)
ufw allow 50000:50100/udp  # LiveKit RTC media
```

Do **not** expose 3000 or 7880 — they are loopback/proxied only.

## First deployment

```bash
git clone <repo> voice-chat && cd voice-chat
cp .env.example .env
nano .env               # fill in DOMAIN, secrets (openssl rand -hex 32), S3 credentials
docker compose up -d --build
```

Open `https://{DOMAIN}` — the **first registered account becomes the admin**
(seeds #general + a voice channel). Invite friends via the admin panel
(gear icon → «Приглашения»); each link works once.

## Updating

```bash
git pull
docker compose up -d --build
```

The database schema migrates automatically on app startup.

## Backups

Everything except attachments lives in the bundled Postgres service (`pg-data`
volume); attachments live in the S3 bucket. Copying the volume of a **running**
Postgres is not a valid backup — use `pg_dump`:

```bash
docker compose exec postgres pg_dump -U postgres voicechat > backup-$(date +%F).sql
```

Restore with `docker compose exec -T postgres psql -U postgres voicechat < backup.sql`
(into an empty database). Run a dump manually before every risky upgrade.

## Migrating an existing SQLite deployment (one-time cutover)

Deployments created before v0.12.0 keep their data in `/data/app.sqlite` on the
`app-data` volume. The image ships a one-shot import script; the cutover is:

```bash
git pull                                        # brings compose.yaml with the postgres service
# .env: add POSTGRES_PASSWORD and NUXT_DATABASE_URL (see .env.example)
docker compose exec app bash -c "cp /data/app.sqlite /data/backup.sqlite"   # safety copy
docker compose pull
docker compose up -d postgres                   # start the DB first
docker compose stop app                         # brief downtime starts here
docker compose run --rm app bun scripts/migrate-sqlite-to-pg.ts   # applies schema + copies data
docker compose up -d app                        # downtime over
```

Verify login, history, and search, then (optionally, later) remove the legacy
volume: drop the `app-data` entries from `compose.yaml` and
`docker volume rm <project>_app-data`. The script refuses to run against a
non-empty Postgres, so re-running it can't duplicate data.

## Troubleshooting

| Symptom                                            | Check                                                                                                      |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Certificates not issued                            | Both DNS records resolve to the VPS; ports 80/443 open                                                     |
| Chat works, voice does not connect                 | UDP 50000–50100, UDP 3478 (TURN) and TCP 7881 open in the VPS firewall _and_ the provider's panel firewall |
| Voice roster (sidebar) stays empty while in a call | `docker compose logs livekit` — webhooks must show `sent webhook`, targeting `127.0.0.1:3000`              |
| Files fail to upload                               | S3 env vars in `.env`; bucket must exist; `docker compose logs app`                                        |

## Architecture notes

- **app** — Nuxt server (Bun runtime): UI, REST API, WebSocket hub.
- **postgres** — Postgres 18; reachable only on the compose network, data in the `pg-data` volume.
- **caddy** — TLS termination for the app and for LiveKit signaling (`livekit.{DOMAIN}`).
- **livekit** — SFU on host networking; media flows directly between browsers and the VPS over the UDP range; only signaling passes through Caddy.
- Attachments are stored in the external S3 bucket and served via short-lived presigned URLs.
