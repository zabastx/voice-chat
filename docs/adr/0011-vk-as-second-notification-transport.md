# 0011 — VK as a second notification transport, over Bots Long Poll

Date: 2026-08-26
Status: accepted — implemented 2026-08-26 (v0.22.0). Evidence for the empirical claims below is in
[research/vk-notifications-feasibility.md](../research/vk-notifications-feasibility.md).

**Shipped as decided**, with one deliberate omission: voice notes go to VK as documents rather
than inline voice messages, because matching VK's OGG/OPUS 16 kHz / 16 kbps requirement needs
ffmpeg in the runtime image. The document path is the ADR's own stated fallback; transcoding
remains available later without changing anything else. Long poll is the default and Callback is
config-selectable (`NUXT_VK_INBOUND`) — never both, or VK delivers every event twice.

## Context

[adr/0006](0006-telegram-notifications.md) gave an offline Member one way to be reached: Telegram.
That covers most of the friend group, but not all of it, and a Member who does not use Telegram has
no out-of-band channel at all. VK is the obvious second, since everyone in the group already has an
account.

Two things made this worth checking before committing rather than after. First, ADR 0006's whole
transport design is scar tissue: the prod host (`…cloud.ru`) filters Telegram traffic in **both**
directions, which is why a standalone `telegram-relay` service exists at all. A second messenger
could easily inherit the same tax. Second, reply-to-send is the half of ADR 0006 that carries the
design: it needs the messenger to tell us, on an incoming reply, _which_ earlier bot message was
replied to. Telegram gives `reply_to_message.message_id`. VK's docs describe `reply_message` as an
untyped `object` and list none of its fields, and separately warn that the common message id "may be
absent in some cases" — so on paper the feature might simply not be buildable.

Both were settled empirically on 2026-08-26 with [scripts/vk-reply-spike.ts](../../scripts/vk-reply-spike.ts)
against a live community, and both came back positive. That is what makes this decision recordable
rather than speculative.

## Decision

**VK becomes a second Notification Transport by generalizing the existing one, not by duplicating
it.** Everything in ADR 0006 that is about _when and what_ to notify — offline detection via
`wsOnline()`, the two triggers (`@`-mention in a Text Channel, any DM), the fire-and-forget contract,
the 7-day mapping sweep, routing a reply through `createChannelMessage()` — stays exactly as it is
and stays shared. What changes is that the `telegram_`-prefixed names underneath it become
transport-neutral, and the send step goes behind an interface.

The specifics VK forces, each different from Telegram:

- **Transport is Bots Long Poll, in-process. No relay, no ingest route.**
  `groups.getLongPollServer` → `GET {server}?act=a_check&key&ts&wait=25`, handling `failed:1/2/3`.
  Both hops are outbound HTTPS, but to **two different hosts** — the method calls go to
  `api.vk.ru`, the poll itself to whatever `groups.getLongPollServer` returns, currently
  `lp.vk.ru`. Allowlist both. Being outbound-only, the inbound-filtering failure that produced
  `telegram-relay` structurally cannot recur. The poll loop lives in a Nitro plugin next to the
  existing sweeper; `handleVkUpdate(update)` stays free of `H3Event` so Callback API can be bolted
  on later without moving logic.

- **Linking is `vk.me/club<group_id>?ref=<token>` plus the «Начать» button**, reusing the same
  short-lived single-use Linking Token the Telegram flow already mints. Verified: the Start press
  delivers `payload={"command":"start"}` **and** `ref=<token>` on the same `message_new`, so the
  token round-trips on one tap with no typing — parity with `t.me/<bot>?start=<token>`.
  The «Добавить кнопку "Начать"» toggle must be on in the community settings; it is undocumented on
  dev.vk.ru and exists only in the admin UI.

- **Bind on `ref`, never on `message_allow.key`.** `message_allow` does fire, but its `key` arrives
  empty (`{"user_id":…,"key":""}`) — that field is populated only by
  `messages.allowMessagesFromGroup`, which needs a user token VK issues "in exceptional cases".
  `message_allow` is a consent signal, not a token carrier.

- **The Notification Mapping stores both VK id spaces and matches a reply against either.**
  A notification is sent with `messages.send` + `peer_ids` (≥ v5.124), which returns
  `{peer_id, message_id, conversation_message_id}`; both are recorded. This is a schema _difference_
  from `telegram_notifications`, not a rename. Verified: `reply_message` arrives in a 1:1
  user↔community dialog carrying seven populated fields (`date`, `from_id`, `text`, `attachments`,
  `conversation_message_id`, `id`, `peer_id`), with both ids matching the probe, byte-identically
  from the web and Android clients.
  The pair is stored rather than just `conversation_message_id` because the spike ran in a fresh
  dialog where the two counters had not yet diverged — it proves both are _populated_, not that
  either is always present.

- **Blocked detection parses the body, and also listens.** VK returns HTTP 200 with
  `error.error_code`; `901` ("Can't send messages for users without permission") is the analogue of
  Telegram's 403 → auto-unlink, and it fires on the upload calls too, not only on the send. On top
  of that VK _pushes_ `message_deny`, so auto-unlink is event-driven rather than waiting for the
  next failed send.

- **Media is one call, with two degradations.** Text and attachments ride the same `messages.send`,
  so ADR 0006's caption-vs-message split collapses to one delivered message and one mapping row.
  But voice messages must be OGG/OPUS at 16 kHz / 16 kbps / ≤5 min, which
  [useVoiceRecorder.ts](../../app/composables/useVoiceRecorder.ts) does not produce (WebM/Opus or
  MP4/AAC) — so transcode server-side or downgrade voice notes to documents. And the community
  access-key rights table has no `video` entry, so video attachments ride the document path.

- **Message Source gains a third value.** `source: ['app', 'telegram']`
  ([adr/0007](0007-message-source.md)) becomes `['app', 'telegram', 'vk']`, so a reply sent from VK
  is badged as such rather than lying about which bridge it came through.

## Options considered

**Callback API instead of Long Poll.** Genuinely competitive, and better on three counts: VK retries
failed deliveries (10 s / 3 min / 10 min / 30 min / 1 h with `X-Retry-Counter`), there is no poll
loop to own or to tear down on HMR, and 10 servers per community would survive scaling past one app
instance. It loses on the one axis this deployment has already been burned on: it requires VK's
servers to reach our host, and this host demonstrably filters inbound traffic from a messenger's
servers. Long Poll has no inbound leg, so it cannot hit that failure at all. The Callback setup
screen's «Подтвердить» handshake is a free reachability test against the prod host — worth running,
and if it succeeds this decision is cheap to revisit, which is exactly why `handleVkUpdate` is kept
transport-shaped.

**Callback was then driven end-to-end (2026-08-26), through an ngrok tunnel to the same spike.** It
works completely: confirmation handshake, secret rejection, event delivery, reply routing. Two
things came out of that run which the docs do not spell out:

- **The delivered event objects are byte-identical to Long Poll's.** The same reply produced the
  same seven-field `reply_message` over both transports. This is what makes "one handler, either
  transport" a fact rather than a hope, and it is why switching later costs nothing but wiring.
- **`messages.send` accepts `reply_to`,** so we can answer a specific VK message rather than
  posting a loose one. ADR 0006's Telegram hints ("reply to a more recent one") are untethered
  text; the VK equivalents can quote the message they are about.

None of this changes the decision. The case for Long Poll was never "Callback does not work" — it
was "Callback requires VK's servers to reach the prod host, and this host has already proven it
filters exactly that". A tunnel is reachable from the internet by construction, so this run says
nothing about the prod host, and the deciding test remains unrun.

**A parallel `vk_*` set of columns and a `vk.ts` mirroring `telegram.ts`.** Faster to write and
requires touching no existing code, which is its whole appeal. Rejected because the duplicated part
is the part that carries the risk: ADR 0006 already warns that "a new message-emitting path that
bypasses `createChannelMessage` could skip notification or leak", and a second copy of the delivery
logic is precisely that path. Two transports is also the point at which the shape becomes clear;
generalizing later, with two divergent implementations to reconcile, is strictly harder.

**Keying the mapping on `conversation_message_id` alone.** Simpler, and probably correct. Rejected
because nothing in the spike makes it _safer_ than storing the pair — the run could not distinguish
the two id spaces — while the cost of the extra column is one integer per notification.

## Consequences

- The privacy invariant from ADR 0006 gets stricter, not merely copied. A Telegram `chat_id` is
  opaque and bot-scoped; a VK `peer_id` **is** the public user id (`vk.com/id<peer_id>`), so leaking
  one deanonymizes the Member rather than just identifying a chat. It must stay out of the Member
  DTO and the session cookie exactly as before, and any new code returning Member rows has a
  correspondingly larger blast radius if it slips. The derived public boolean (reachability, not
  identity) stays safe.

- The single-instance caveat carries over unchanged: two app instances polling with the same `key`
  would split updates between them, the same class of problem as two instances fighting over
  `setWebhook`. Fine for the current deploy.

- One documented rule we will be out of compliance with: [Bots Rules](https://dev.vk.ru/ru/bots-rules)
  item 8 requires passing `content_source` when relaying user-generated content, naming
  "bots that help users communicate with each other" as the case. We have no VK-side source to
  point at and a URL into a private app is not meaningfully verifiable. Low practical risk for a
  closed friend group; recorded so nobody rediscovers it as a surprise.

- **If Callback is ever chosen, registering the server is only half of it.** Confirming a Callback
  server and subscribing it to events are independent operations, and the first succeeds with the
  second completely empty — `groups.getCallbackServers` reports `status: "ok"` while
  `groups.getCallbackSettings` reports every event `0`, so the admin UI looks healthy and not one
  event is ever delivered. This cost time during the 2026-08-26 run. Provisioning code must call
  `groups.setCallbackSettings` after registering, and health checks must assert on the event flags,
  not on the server status. Long Poll has the same split (the community's event-type tab is
  separate, and the two tabs do not share state) but shows it sooner, because nothing arrives at a
  poller that was never subscribed.

- **The prod host does reach VK outbound (measured 2026-08-26).** This was the one thing that could
  have collapsed the "no relay" conclusion, and it did not: from the VPS,
  `https://api.vk.ru/method/utils.getServerTime` answers `200` via `87.240.137.206`, and the long
  poll host — a _different_ host, `lp.vk.ru`, which `groups.getLongPollServer` hands back as
  `https://lp.vk.ru/whp/<group_id>` — answers `403` on its bare root via `95.213.56.4`. A refusal
  is the right answer there (the endpoint needs its path and query); what matters is that the host
  replied instead of hanging. **Both resolved to IPv4**, which is precisely the failure
  `api.telegram.org` hit: IPv6-only resolution with no working v6 egress. Long Poll is therefore
  viable on the current deploy with no relay, as decided.

  Worth keeping straight: this measures the **outbound** direction only, which is all Long Poll
  needs. Callback needs the **inbound** one — VK's servers reaching the app — and that remains
  unmeasured against the prod host; the «Подтвердить» handshake aimed at prod is still the test.

- The glossary is deliberately **not** updated yet. `CONTEXT.md` currently defines Telegram Link,
  Telegram Notification, and a Notification Mapping shaped around Telegram's single id. Those terms
  become transport-neutral when this is built, not when it is decided; editing them now would leave
  the glossary describing something that does not exist.
