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

**Update (2026-07-10, v0.16.0):** the invariant is relaxed for one derived field. `memberDto` now
carries `telegramNotifications: boolean` (`telegram_chat_id` set AND notifications enabled), so any
authenticated Member can see who is reachable via Telegram — it powers the Telegram icon in the
members panel and rides along inside `DmConversationDto`. The raw `telegram_chat_id` and the link
token remain secrets exactly as above; every Telegram state change (link, unlink, toggle, 403
auto-unlink) now broadcasts a `member.updated` frame so the icon stays live.

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

## Update: media forwarding (2026-07-06)

Notifications were text-only: `notifyOffline` sent `decodeMentions(content)` via `sendMessage` and
dropped every Attachment. Now a Telegram Notification carries the **full text and the attachments**:
voice messages → `sendVoice`, images → `sendPhoto`, video → `sendVideo`, other files →
`sendDocument`, each routed through a new multipart relay route `POST /sendMedia`. Text becomes the
caption of the first media message when it fits Telegram's 1024-char caption limit; otherwise it
goes as its own `sendMessage` ahead of the media. Each delivered Telegram message (text or media)
gets its own `telegram_notifications` mapping row, so a reply to any of them still routes.

**Transport is app-downloads-then-uploads, not a presigned-URL passthrough.** Telegram's servers
would have to fetch a presigned URL directly from S3, but the bucket is private and in dev its
endpoint (MinIO on `localhost`) is unreachable from Telegram; relying on a public prod endpoint
would be fragile across environments. Instead the app fetches the object via the existing header-
signed `getObject` (streamable `Response`), uploads the bytes multipart to the relay's `/sendMedia`,
and the relay re-packs them under Telegram's expected field name (`voice`/`photo`/`video`/`document`)
and forwards to the matching `send*` method. The app↔relay hop is plain HTTP (which the prod host
does not filter); the relay↔Telegram hop is on the relay's clean network. Bytes are buffered in
memory (≤25 MB) — acceptable at friend-group scale; streaming is a future optimization.

**Links stay clickable via plain text.** `disable_web_page_preview` stays `true` (no rich preview
cards, preserving the SSRF/privacy posture that deferred M6 link previews). URLs are made clickable
by sending plain text (no `parse_mode`) and pre-processing the body with `plainTextBody` — markdown
link syntax `[t](url)` is collapsed to the bare URL (auto-linked by Telegram), and URLs are stashed
during markdown-marker stripping so `_` inside a URL is not lost.

**Failure handling is unchanged in spirit.** `notifyOffline` stays fire-and-forget and never throws
into the send path. A media fetch/upload failure is logged and swallowed for that one attachment. If
the message had **text** and none of it was delivered (the text was meant to ride as a caption on
the first media item but every media send failed, or the standalone `sendMessage` for overlong text
itself failed), the text is recovered as its own `sendMessage` — appending
`(вложение не удалось переслать)` when the media also failed, so the recipient knows an attachment
didn't come through. If the message had **no text** and _all_ its media failed, the header
(who/where) plus a `(вложение не удалось переслать)` note is sent so the recipient still has
context (no mapping row — a reply to the hint must not route into a channel). A 403 from Telegram
still auto-unlinks the Member on the first send that hits it.
