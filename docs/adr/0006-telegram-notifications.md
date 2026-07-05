# 0006 — Telegram notifications with reply-to-send

Date: 2026-07-05
Status: accepted (transport superseded 2026-07-06 — see "Update: relay transport")

## Context

Mentions and DMs are delivered only over the WebSocket, so a Member with the tab closed learns
nothing until they return. For a small friend group the natural out-of-band channel is Telegram:
most Members already have it, and its bots can both push a message and receive a reply. We want an
offline Member to be pinged in Telegram when someone `@`-mentions them in a Text Channel or sends
them a DM, and — the interesting half — to **reply inside Telegram** and have it land back in the
right Channel/DM without opening the app.

The constraints that shaped this: the app already knows Presence (`wsOnline()`), already encodes
mentions to `<@id>` tokens with a `mentionedIds()` extractor, and already routes message delivery
by audience through `emitChannelEvent()`. A bot token exists. The deployment is single-instance.

## Decision

- **Transport is a webhook** (superseded — see the Update below). Original decision: on boot the app
  calls `setWebhook`, and `POST /api/telegram/webhook` verifies `X-Telegram-Bot-Api-Secret-Header`.

- **Linking is a deep-link `/start` token.** Settings mints a short-lived (15 min), single-use
  `telegram_link_token` and opens `t.me/<bot>?start=<token>`. The bot consumes it on `/start`,
  binding `message.chat.id` to the Member. One click, no manual code entry.

- **Offline = no live WS connection** (`!wsOnline().includes(memberId)`) at send time. An online
  Member already gets the in-app notification, so Telegram stays quiet.

- **Triggers are exactly two:** a literal `@`-mention in a Text Channel (`mentionedIds` minus the
  author) and any DM message (the other participant). Plain replies-without-mention and
  edited-in mentions are deliberately excluded.

- **Reply routing uses a per-notification mapping.** Every delivered notification stores a
  `telegram_notifications` row `{chat_id, telegram_message_id, member_id, channel_id}`. A Telegram
  reply is looked up by `(chat_id, reply_to_message.message_id)` → the reply is posted into that
  exact Channel/DM **as** `member_id`, through the shared `createChannelMessage()` path (so mentions
  are encoded and the audience/broadcast are identical to an in-app send). A reply to an unmapped or
  swept notification, a non-reply message, or media all get a one-line Russian hint and post nothing.

- **Send path is factored.** `createChannelMessage()` in `server/utils/messages.ts` holds the
  insert + attachment-claim + read-cursor + DTO + `emitChannelEvent` + `notifyOffline` core; both
  the HTTP send route and the webhook call it. `notifyOffline` is fire-and-forget — it never blocks
  or fails a send.

- **Failure handling:** a `403` from Telegram (bot blocked/deleted) auto-unlinks the Member
  (`clearTelegramLink(id, disableNotifications=true)`); other errors are logged, not retried.

- **Retention:** mapping rows are swept after 7 days on the boot + hourly `setInterval` pattern from
  `plugins/db.ts`.

## Privacy invariant

`telegram_chat_id` and the linking token are secrets. They must **never** enter `memberDto` (which
is broadcast to everyone via `member.updated`) nor the sealed session cookie. A Member's own link
status is exposed only through the authenticated `GET /api/me/telegram`. Any new code that returns
Member rows to clients must not include the telegram columns.

## Consequences

- Reply-from-Telegram is a first-class Message: same DTO, same audience isolation as a DM, same
  mention encoding — because it reuses `createChannelMessage`. The risk this accepts is the same as
  ADR 0005: a new message-emitting path that bypasses that helper could skip notification or leak.
- The mapping table grows with notification volume but is bounded by the 7-day sweep; replying to a
  notification older than a week degrades to the "reply to a more recent one" hint. Acceptable at
  friend-group scale.
- Single-instance only: `setWebhook` is idempotent, but two app instances would fight over it and
  both process updates. Not a concern for the current deploy; revisit if it ever scales out.
- Media/attachments from Telegram are out of scope for this version (text replies only); nothing
  here precludes adding file forwarding later through the storage pipeline.

## Update: relay transport (2026-07-06)

The in-app webhook could not work in production. The prod host (`…cloud.ru`) **filters Telegram
traffic in both directions**: outbound to `api.telegram.org` resolved to IPv6-only and timed out (a
temporary IPv4 `extra_hosts` pin got `sendMessage` working), and inbound webhook delivery from
Telegram's servers to the public HTTPS endpoint **timed out** (`getWebhookInfo` →
`"Connection timed out"`), so linking and replies never arrived. The endpoint was reachable from the
normal internet — only Telegram's path was blocked.

Fix: a standalone **`telegram-relay`** Nitro service (`telegram-relay/`), hosted on a network with
clean Telegram access. It is **stateless and owns no logic** — a pure connectivity shim:

- `POST /send` (called by the main app, bearer-authed) → proxies `sendMessage`, returns
  `{ messageId, blocked }`.
- `POST /telegram/webhook` (called by Telegram, secret-header-authed) → forwards the raw update to
  the main app's `POST /api/telegram/ingest` (bearer-authed); returns 502 on ingest failure so
  Telegram retries.

The main app now reaches the relay over ordinary (non-Telegram) HTTP, which the host does **not**
filter, and no longer contacts `api.telegram.org` at all — so it needs no bot token and the
`extra_hosts` pin was removed. Everything else in this ADR is unchanged: the main app still owns all
linking, the mapping table, offline detection, and message posting; `tgSendMessage` just calls the
relay instead of Telegram, and the old `webhook.post.ts` became `ingest.post.ts`. The relay
registers the webhook (`setWebhook`) on its own boot, so the "single-instance / one webhook" caveat
above now applies to the relay. Config moved from `NUXT_TELEGRAM_BOT_TOKEN`/`_WEBHOOK_URL`/`_SECRET`
to `NUXT_TELEGRAM_RELAY_URL` + `NUXT_TELEGRAM_RELAY_SECRET` (the bot token lives only in the relay).
