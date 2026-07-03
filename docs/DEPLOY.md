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

The SQLite schema migrates automatically on startup.

## Backups

Everything except attachments lives in one SQLite file inside the `app-data`
volume; attachments live in the S3 bucket. To back up the database:

```bash
docker compose exec app bash -c "cp /data/app.sqlite /data/backup.sqlite"
docker cp "$(docker compose ps -q app)":/data/backup.sqlite ./backup-$(date +%F).sqlite
```

## Troubleshooting

| Symptom                                            | Check                                                                                         |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Certificates not issued                            | Both DNS records resolve to the VPS; ports 80/443 open                                        |
| Chat works, voice does not connect                 | UDP 50000–50100, UDP 3478 (TURN) and TCP 7881 open in the VPS firewall _and_ the provider's panel firewall|
| Voice roster (sidebar) stays empty while in a call | `docker compose logs livekit` — webhooks must show `sent webhook`, targeting `127.0.0.1:3000` |
| Files fail to upload                               | S3 env vars in `.env`; bucket must exist; `docker compose logs app`                           |

## Architecture notes

- **app** — Nuxt server (Bun runtime): UI, REST API, WebSocket hub, SQLite at `/data/app.sqlite`.
- **caddy** — TLS termination for the app and for LiveKit signaling (`livekit.{DOMAIN}`).
- **livekit** — SFU on host networking; media flows directly between browsers and the VPS over the UDP range; only signaling passes through Caddy.
- Attachments are stored in the external S3 bucket and served via short-lived presigned URLs.
