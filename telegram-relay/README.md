# telegram-relay

A tiny, **stateless** Nitro service that gives the voice-chat app Telegram
connectivity from a host that isn't network-filtered. It owns **no** business
logic and **no** database — it only:

1. **`POST /send`** (called by the main app) → proxies `sendMessage` to Telegram,
   returns `{ messageId, blocked }`.
2. **`POST /telegram/webhook`** (called by Telegram) → forwards the raw update to
   the main app's `INGEST_URL`.

All linking, reply routing, offline detection, and message posting stay in the
main app (see its `docs/adr/0006-telegram-notifications.md`).

```
Telegram  ⇄  telegram-relay (this, clean host)  ⇄  voice-chat app
             POST /send  ← main app
             POST /telegram/webhook  ← Telegram → forwards to INGEST_URL
```

## Why this exists

The main app is hosted where Telegram traffic is filtered in **both** directions
(outbound to `api.telegram.org` and inbound from Telegram's webhook servers time
out). This relay runs somewhere with clean Telegram access; the main app reaches
the relay over normal (non-Telegram) HTTP, which is not filtered.

## Configure

Copy `.env.example` → `.env` and fill in:

| Var                       | Meaning                                                                          |
| ------------------------- | -------------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`      | Bot token from @BotFather                                                        |
| `TELEGRAM_WEBHOOK_URL`    | This relay's own public HTTPS URL, ending `/telegram/webhook`                    |
| `TELEGRAM_WEBHOOK_SECRET` | Random 32+ chars; verifies Telegram's requests                                   |
| `INGEST_URL`              | Main app endpoint: `https://<domain>/api/telegram/ingest`                        |
| `RELAY_SECRET`            | Shared bearer secret; **must equal** the main app's `NUXT_TELEGRAM_RELAY_SECRET` |
| `PORT`                    | Listen port (default 3000)                                                       |

The relay serves plain HTTP on `PORT`; **Telegram requires HTTPS**, so it must sit
behind TLS termination and be able to reach `INGEST_URL`.

## Deploy (Docker Compose, with TLS)

The bundled [compose.yaml](compose.yaml) runs the relay plus a Caddy sidecar that
fetches a Let's Encrypt cert for `RELAY_DOMAIN` — no external reverse proxy needed.
Point `RELAY_DOMAIN`'s DNS at the host, open 80/443, then:

```bash
cp .env.example .env      # fill in RELAY_DOMAIN + the vars below
docker compose up -d --build
```

On boot the relay calls `setWebhook`, pointing Telegram at `TELEGRAM_WEBHOOK_URL`
(`https://${RELAY_DOMAIN}/telegram/webhook`).

## Run without the bundled proxy

If you already have a reverse proxy (nginx/Traefik) or a tunnel (Cloudflare), run
just the app and terminate TLS yourself:

```bash
bun install
bun run dev                       # local
bun run build && bun start        # production (bun .output/server/index.mjs)
# or: docker build -t telegram-relay . && docker run --env-file .env -p 3000:3000 telegram-relay
```

## Main-app side

Set on the voice-chat app (it no longer needs the bot token):

```
NUXT_TELEGRAM_RELAY_URL=https://relay.example.com
NUXT_TELEGRAM_RELAY_SECRET=<same as RELAY_SECRET>
NUXT_PUBLIC_TELEGRAM_BOT_USERNAME=<bot username, no @>
```
