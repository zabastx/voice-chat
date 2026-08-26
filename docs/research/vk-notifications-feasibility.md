# VK (ВКонтакте) as a second notification transport — feasibility

Researched: 2026-08-26. Status: research only, nothing shipped — the decision it fed is
[adr/0011](../adr/0011-vk-as-second-notification-transport.md). Compare against
[adr/0006](../adr/0006-telegram-notifications.md), which this checks VK against item by item.

> Sources below are cited on `dev.vk.com`; the same pages live on `dev.vk.ru/ru/…` and that
> is the host that answers automated fetches — use it when re-checking a claim. The message-object,
> bot-messages, and rate-limit claims were re-verified there on 2026-08-26.

## Verdict

**Yes — the two open questions were settled empirically on 2026-08-26 and both came back positive.**
Reply routing works: `reply_message` arrives on a 1:1 user↔community `message_new`, carries both
`id` and `conversation_message_id`, and both matched the probe, identically from the web and the
mobile client. Linking is one tap: the «Начать» button delivers `payload={"command":"start"}` **and**
the `ref` from the `vk.me?ref=` link in the same message, so the deep-link token round-trips exactly
like `t.me/<bot>?start=<token>`. On top of that, VK is strictly better on transport — **Bots Long
Poll is outbound-only, so VK needs no relay service at all**, where `telegram-relay` exists purely
because the prod host filters inbound webhook delivery. What remains is not risk but work:
generalizing the `telegram_`-prefixed schema into a per-transport shape, and transcoding voice
messages to OGG/OPUS 16 kHz.

Evidence: [scripts/vk-reply-spike.ts](../../scripts/vk-reply-spike.ts), run against a live community
(`group_id` 241075188), raw events in `vk-spike-updates.jsonl`. Verbatim results in §1 and §3.

## Capability parity

| #   | Capability                                  | Telegram mechanism                                            | VK mechanism                                                                                                                | Verdict                                                                                   |
| --- | ------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1   | One-click linking with a token              | `t.me/<bot>?start=<token>` → `/start <token>`                 | `vk.me/<screen_name>?ref=<token>` → `ref` on the `message_new` message object, plus a «Начать» button in community settings | **parity — verified 2026-08-26** (Start press delivers `ref` + `{"command":"start"}`)     |
| 2   | Push to a linked user                       | `sendMessage(chat_id, text)`                                  | `messages.send(peer_id, message)` with a community token                                                                    | parity                                                                                    |
| 3   | Reply in the messenger lands in the channel | `reply_to_message.message_id` → `(chat_id, msg_id)` lookup    | `reply_message` on the incoming message + `message_id`/`conversation_message_id` from `messages.send`                       | **parity — verified 2026-08-26** (`reply_message` carries both ids; web and mobile alike) |
| 4   | Media forwarding                            | `sendPhoto`/`sendVideo`/`sendVoice`/`sendDocument`, multipart | upload server → `*.save` → `attachment` string on `messages.send`                                                           | degraded (voice needs transcoding; community token has no `video` right)                  |
| 5   | Blocked → auto-unlink                       | HTTP `403` from Bot API                                       | error code `901` in a **200** body, plus a pushed `message_deny` event                                                      | parity, arguably better (event-driven)                                                    |
| 6   | Transport / delivery model                  | inbound webhook → needed a standalone relay                   | Bots Long Poll (outbound only) **or** Callback API (inbound)                                                                | better (no relay)                                                                         |
| 7   | Rate limits and account requirements        | bot token, no documented per-second cap in use                | community token, 20 req/s, `messages` + `photos` + `docs` rights                                                            | parity                                                                                    |
| 8   | Privacy invariant                           | `chat_id` is opaque and bot-scoped                            | `peer_id` **is** the public VK user id                                                                                      | degraded (same rule, higher stakes)                                                       |

## 1. Linking via deep link with a token

VK's closest analogue to `t.me/<bot>?start=<token>` is the `vk.me` short-link with an arbitrary
parameter. From
[Community Messages](https://dev.vk.com/en/api/community-messages/getting-started): you can

> transfer arbitrary parameters to such a link `ref` and `ref_source` which will return in the
> message object in event `message_new` Callback API or Bots Long Poll API if the user starts or
> continues a conversation at a link of the type `vk.me`

with the documented forms `vk.me/{group_name}?ref={ref}&ref_source={ref_source}` and
`vk.com/write-{group_id}?ref={ref}&ref_source={ref_source}`. The receiving side is the `ref` /
`ref_source` fields on the [message object](https://dev.vk.com/en/reference/objects/message)
("Arbitrary parameter for working with sources of Transition"), which is what `message_new` carries
under `object.message` for API ≥ 5.103
([community events](https://dev.vk.com/en/api/community-events/json-schema)).

**VK does have a Start button** (corrected 2026-08-26). An earlier draft of this section claimed it
did not, on the grounds that dev.vk.com never mentions one. The community admin UI has it:
Управление → Сообщения → Настройки для бота → **«Добавить кнопку "Начать"»**, whose own tooltip
reads _«Если эта настройка включена, то при заходе в чат с вашим сообществом в первый раз
пользователь увидит кнопку с командой "Начать"»_. Source: the settings page itself — the developer
docs do not describe this toggle, which is why the doc-only pass missed it. So the linking flow is
one tap, not "type something", the same shape as Telegram's Start.

**Spike result (2026-08-26): `ref` survives the Start press.** Opening
`https://vk.me/club241075188?ref=spike-15hjfpsc` and tapping «Начать» produced one `message_new`
carrying all three things at once:

```
from_id=550358385 peer_id=550358385 id=1 cmid=1
text: "Начать"
ref="spike-15hjfpsc" ref_source=undefined
payload="{\"command\":\"start\"}"
```

So linking is at full parity with `t.me/<bot>?start=<token>`: one tap, no typing, and the token
arrives server-side on a message we can bind to the Member. The conventional
`{"command":"start"}` payload is confirmed, and `ref_source` is simply absent when the link does
not set it.

**Bind on `ref`, not on `message_allow`.** The same run fired `message_allow` — but with an empty
key: `{"user_id":550358385,"key":""}`. The `key` field is populated only by
`messages.allowMessagesFromGroup`, which (see below) we cannot call. `message_allow` is therefore
useful as a consent signal, not as a token carrier; the token comes from `ref` on `message_new`.

Still unverified: whether `ref` is delivered on every message from that link or only the first, and
whether it survives when a conversation with the community already exists (the relink case). Both
matter only for re-linking an already-linked Member; the first-link path is proven.

Two documented alternatives, both unavailable to a plain website:

- [`messages.allowMessagesFromGroup(group_id, key)`](https://dev.vk.com/en/method/messages.allowMessagesFromGroup)
  takes a `key` — "Random string, can be used for the user identification. It returns with
  `message_allow` event in Callback API", max length 256. That is a cleaner token round-trip than
  `ref`, but the method needs a **user** access token from a standalone app via Implicit Flow, which
  the docs say is "issued in exceptional cases by a request to support".
- The same `key` is accepted by
  [`VKWebAppAllowMessagesFromGroup`](https://dev.vk.com/en/bridge/VKWebAppAllowMessagesFromGroup)
  in VK Bridge — but that is only for VK Mini Apps and "will become available to users after your
  application passes moderation".
- The [Allow Community Messages widget](https://dev.vk.com/en/widgets/allow-messages-from-community)
  (`VK.Widgets.AllowMessagesFromCommunity`) works on an external site and fires
  `widgets.allowMessagesFromCommunity.allowed` with the user id — but it takes **no** `key`
  parameter, requires loading `openapi.js` from `vk.ru` into our page, and depends on the visitor
  being logged into VK in that browser. Binding on a client-reported user id would also be
  spoofable; it is not a substitute for a server-side token.

So: `vk.me?ref=<token>` is the one to build on, with the same 15-minute single-use token the
Telegram flow already mints.

## 2. Pushing a message

[`messages.send`](https://dev.vk.com/en/method/messages.send) with `peer_id` (for a user, the plain
user id) and `message` (max 9000 chars), called with a **community access token** with the
`messages` right. It "Returns sent message ID". Useful parity details:

- `dont_parse_links` — "1 -- links will not attach snippet", the analogue of the current
  `disable_web_page_preview: true`, so the SSRF/preview posture from ADR 0006 carries over.
- `disable_mentions` — "1 -- mention of user will not generate notification for him".
- `random_id` is the dedupe key; [bot docs](https://dev.vk.com/en/api/bots/development/messages) say
  "This parameter should always be unique, so use large random numbers."
- Attachments ride on the **same** `messages.send` call as the text, so one notification is one
  delivered message. Telegram's caption-vs-message split (`TG_CAPTION_MAX`, steps 1–4 of
  `notifyOffline`) has no VK equivalent and collapses to a single send with a single mapping row.

## 3. Reply routing — the critical one

This is where the answer is "probably, but the docs won't confirm it".

**What is documented.** The [message object](https://dev.vk.com/en/reference/objects/message)
declares `reply_message` — "Message to which the current one is sent" — and separately
`conversation_message_id`, "A unique automatically increasing number for all messages with this
peer". The page describes `reply_message` as an `object` and **does not list a single one of its
fields**. `messages.send` can be sent with `reply_to` ("Id of replied message") in the other
direction.

**The two id spaces.** [Bot messages](https://dev.vk.com/en/api/bots/development/messages) is
explicit that they differ and that one can be missing:

> Parameter `conversation_message_id` allows the bot to interact with messages without the use of a
> common message id, **which may be absent in some cases**.

and gives the way to learn both at send time:

> The required message identifier can be obtained in advance by calling the method `messages.send`
> with parameter `peer_ids` and API version not lower than 5.124.

`messages.send` confirms the shape: with `peer_ids`, it "returns an array of objects containing the
following fields: `peer_id`, `message_id`, `conversation_message_id`, `error`". `peer_ids` accepts
up to 100 ids, so passing a single recipient is a legitimate way to get both ids back instead of the
bare integer. There is also
[`messages.getByConversationMessageId(peer_id, conversation_message_ids)`](https://dev.vk.com/en/method/messages.getByConversationMessageId)
for resolving one from the other after the fact.

**What `reply_message` most likely contains.** VK's own machine-readable API schema — the
[`VKCOM/vk-api-schema`](https://github.com/VKCOM/vk-api-schema) repo, which is VK's org but not the
documentation site, so treat it as one step below primary — types `reply_message` as
`messages_foreign_message`, and that definition declares both `id` ("Message ID") and
`conversation_message_id` ("Conversation message ID"), alongside `from_id`, `peer_id`, `text`,
`date`, `attachments`, `payload`
([messages/objects.json](https://github.com/VKCOM/vk-api-schema/blob/master/messages/objects.json)).
If that holds at runtime, the reply lookup works exactly like Telegram's, keyed on
`(peer_id, reply_message.conversation_message_id)`.

**What the docs do not state, and must be measured:**

- whether `message_new` for a 1:1 user↔community dialog includes `reply_message` at all;
- whether `reply_message.id` is populated there or is one of the "some cases" where the common
  message id is absent (in which case only `conversation_message_id` is usable);
- whether the VK clients (web, iOS, Android) all offer "Ответить" on a community's message inside a
  personal dialog — the docs never discuss the client UI;
- whether a forwarded message (`fwd_messages`) is what some clients produce instead of a reply.

**Spike result (2026-08-26): it works, and `reply_message` is fully populated.** The probe was sent
with `peer_ids`, which returned `{"peer_id":550358385,"message_id":2,"conversation_message_id":2}`.
Replying to it produced a `message_new` whose `reply_message` was:

```json
{
	"date": 1787721898,
	"from_id": -241075188,
	"text": "СПАЙК: ответь на это сообщение…",
	"attachments": [],
	"conversation_message_id": 2,
	"id": 2,
	"peer_id": 550358385
}
```

Both ids are present and both matched the probe. The key set —
`date, from_id, text, attachments, conversation_message_id, id, peer_id` — is exactly what VK's own
`vk-api-schema` types as `messages_foreign_message`, so that secondary source is now corroborated at
runtime. **The web client and the Android client produced byte-identical `reply_message` objects**,
which closes the "do all clients offer Ответить" question for the two that matter. Note also
`from_id: -241075188` — the negative community id, confirming the peer-id sign convention.

**Caveat this run cannot settle.** The dialog was brand new, so `id` and `conversation_message_id`
ran in lockstep (1, 2, 3, 4) and were numerically identical. The run therefore proves both fields
are _populated_, but it cannot distinguish which is more robust, and it does not disprove the bot
docs' warning that the common message id "may be absent in some cases" — that would need a dialog
with enough history for the two counters to diverge.

**Recommended design, unchanged by the result:** store _both_ ids for every delivered notification
and match an incoming reply against either. That is a schema difference from
`telegram_notifications`, not a rename — see below. Keying on `conversation_message_id` alone would
probably work, but nothing in this run makes that safer than storing the pair.

**The spike that produced the above** is [scripts/vk-reply-spike.ts](../../scripts/vk-reply-spike.ts)
— it resolves the target user, sends the probe with `peer_ids`, long-polls, and prints which id
space matched. Re-run it if VK's behaviour ever needs re-checking; delete it once this lands in an
ADR.

## 4. Media forwarding

All VK uploads follow the same three steps from the
[upload overview](https://dev.vk.com/en/api/upload/overview): get an upload address, POST the file
as `multipart/form-data`, save. **Bytes are uploaded from our server** — there is no
"give VK a public URL" path for photos or documents (the only URL-based option is `video.save`'s
`link` parameter for external video hosting). The existing
`getObject(objectKey) → arrayBuffer → FormData` flow in `server/utils/telegram.ts` maps over
unchanged, minus the relay hop.

| Kind     | Methods                                                                                                                                                                         | Limits                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Photo    | [`photos.getMessagesUploadServer(peer_id)`](https://dev.vk.com/en/method/photos.getMessagesUploadServer) → POST field `photo` → `photos.saveMessagesPhoto(photo, server, hash)` | JPG/PNG/GIF; ≤50 MB; height+width ≤14 000 px; aspect ≥1:20 ([photo in message](https://dev.vk.com/en/api/upload/photo-in-message)) |
| Document | [`docs.getMessagesUploadServer(type=doc, peer_id)`](https://dev.vk.com/en/method/docs.getMessagesUploadServer) → POST field `file` → `docs.save(file, title)`                   | any format except MP3 and executables; ≤200 MB ([document upload](https://dev.vk.com/en/api/upload/document-in-profile))           |
| Voice    | `docs.getMessagesUploadServer(type=audio_message, peer_id)` → POST field `file` → `docs.save`                                                                                   | **OGG or OPUS; 16 kHz; 16 kbps; ≤5 min** ([voice message upload](https://dev.vk.com/en/api/upload/audio-record))                   |
| Video    | [`video.save`](https://dev.vk.com/en/api/upload/video-in-profile) → POST field `video_file`                                                                                     | AVI/MP4/3GP/MPEG/MOV/MP3/FLV/WMV — but see below                                                                                   |

The save call returns an object whose `owner_id` + `id` become the `attachment` string
(`<type><owner_id>_<media_id>`, e.g. `photo100172_166443618`).

Three things that are not parity:

**Voice needs transcoding.** The 16 kHz / 16 kbps / OGG-or-OPUS requirement is explicit, and our
recorder does not produce that: `app/composables/useVoiceRecorder.ts` picks the first supported of
`audio/webm;codecs=opus`, `audio/webm`, `audio/mp4`, `audio/ogg`, so in Chrome it is WebM/Opus and
in Safari it is MP4/AAC. Either transcode server-side (ffmpeg, `-ar 16000 -b:a 16k -c:a libopus`)
before uploading as `audio_message`, or downgrade voice notes to plain documents for VK. Telegram's
`sendVoice` nominally wants OGG/Opus too and the app already sends WebM at it, but VK spells out
sample rate and bitrate, so silent acceptance is less likely.

**Video probably cannot be sent by a community bot.** The
[community access key rights](https://dev.vk.com/en/reference/access-rights) table lists exactly
`stories`, `photos`, `app_widget`, `messages`, `docs`, `manage` — there is **no `video` right for a
community token**, and `video.save` is documented as a profile upload. Route video attachments to
the document path instead (≤200 MB covers our 25 MB cap comfortably).

**The `audio_message` attachment prefix is documented inconsistently.** `messages.send` lists the
`attachment` types as `photo`, `video`, `audio`, `doc`, `wall`, `market` — no `audio_message` —
while [message attachments](https://dev.vk.com/en/reference/objects/attachments-message) lists
`audio_message` as a valid attachment type on incoming messages, and the voice-upload page's own
worked example passes `attachment=audio743784474_657681015` (an `audio` prefix for something
`docs.save` returned as `"type":"audio_message"`). Whichever prefix actually works has to be found
by trying it.

Upload volume is fine: per the [bot docs](https://dev.vk.com/en/api/bots/development/messages),
uploading a photo **with** `peer_id` has "no limit for such uploads, you can upload photos in this
way for an unlimited number of users", while uploading without `peer_id` is capped around 7 000/day.
Same note for documents. Always pass `peer_id`.

## 5. Failure and permission semantics

**The 403 pattern does not transfer.** VK "always" returns a JSON object and the error lives in the
body, not the HTTP status ([query format](https://dev.vk.com/en/api/api-requests)). Detection must
parse `error.error_code`. The relevant codes, per `messages.send`'s own error table and VK's
[errors.json](https://github.com/VKCOM/vk-api-schema/blob/master/errors.json) (schema names, one
step below primary):

- `901` `api_error_messages_deny_send` — "Can't send messages for users without permission"
  (`messages.send`'s table words it "Can't send messages for users without dialogs"). This is the
  direct analogue of Telegram's 403 → `clearTelegramLink(id, true)`.
- `900` `api_error_messages_user_blocked` — "Can't send messages for users from blacklist".
- `902` `api_error_messages_privacy` — "Can't send messages to this user due to their privacy
  settings".
- `914` message too long, `985` notifications-only community, `6` too many requests per second,
  `27` group authorization failed (bad/revoked community token).

Note that `901` also appears on `docs.getMessagesUploadServer` and
`photos.getMessagesUploadServer`, so the unlink check has to run on the upload calls too, not only
on the send.

**VK is better here in one respect:** it _pushes_ the revocation.
[Community events](https://dev.vk.com/en/api/community-events/json-schema) defines `message_deny`
("New ban on messages from the community. The user pressed the button _Banned messages_") carrying
`{user_id}`, and `message_allow` ("The user pressed the button _Allow Messages_ or wrote the first
message to the community") carrying `{user_id, key}`. Auto-unlink can be event-driven instead of
waiting for the next failed send. There is also a pre-flight check with no Telegram equivalent:
[`messages.isMessagesFromGroupAllowed(group_id, user_id)`](https://dev.vk.com/en/method/messages.isMessagesFromGroupAllowed)
returns `{is_allowed: 1|0}`.

The consent model itself is documented on
[Community Messages](https://dev.vk.com/en/api/community-messages/getting-started): "If a user has
written a message to the community first, this equates to agreeing to receive return messages
(without time limits, unless the user has manually banned the messages)." Since our linking flow
_is_ the user writing first, consent is obtained by construction. The same page warns: "You can't
get a list of all the users who have allowed messages to the community through the API. You need to
store and synchronize this list on your side" — which is what the members table already does.

## 6. Transport — no relay needed

Both models exist, and the outbound-only one is viable.

**Bots Long Poll** ([docs](https://dev.vk.com/en/api/bots-long-poll/getting-started)): enable it in
Управление → Работа с API → Long Poll API, pick event types, then

1. `groups.getLongPollServer(group_id)` (works with a plain **community access token**, no extra
   right listed) → `{key, server, ts}`;
2. `GET {server}?act=a_check&key={key}&ts={ts}&wait=25` — "since some proxy servers terminate the
   connection after 30 seconds, we recommend that you specify `wait = 25`. The maximum value — 90";
3. response `{ts, updates}`; "use the same `server`, `key` and new meaning `ts`" for the next call;
4. errors: `"failed":1` — history outdated, continue with the `ts` from the response;
   `"failed":2` — key expired, re-fetch via `groups.getLongPollServer`; `"failed":3` — information
   lost, re-fetch both `key` and `ts`.

Event objects are identical to the Callback API's, so the same handler serves both.

**Callback API** ([docs](https://dev.vk.com/en/api/callback/getting-started)) is the webhook model:
a publicly reachable HTTPS endpoint, a confirmation handshake (the server must echo the string from
`groups.getCallbackConfirmationCode`; "the confirmation string changes from time to time"), an
optional `secret` field in every notification, a mandatory `ok` reply with HTTP 200, and retries at
10 s / 3 min / 10 min / 30 min / 1 h carrying `X-Retry-Counter`. Up to 10 servers per community, and
optional client-certificate auth.

**The confirmation handshake doubles as a free reachability test.** Callback's setup screen shows
the expected confirmation string and a «Подтвердить» button before anything is built. Pointing the
address at the prod host and pressing it answers, at zero cost, the one question that decided the
Telegram design: can the messenger's servers reach this host at all? A successful confirmation
disproves the relay-class risk and puts Callback back on the table — with its retries
(10 s / 3 min / 10 min / 30 min / 1 h) and its 10-servers-per-community multi-instance story, both
of which long poll lacks. Worth doing before committing to either transport.

**Both transports were driven (2026-08-26), and they deliver identical events.** The same spike
ran in Long Poll mode and again in Callback mode behind an ngrok tunnel; the same reply produced
the same seven-field `reply_message` either way. Callback's full mechanism works — confirmation
handshake, secret rejection (403 on mismatch), delivery, reply routing — and `messages.send`
accepts `reply_to`, so outbound messages can quote a specific VK message. One trap: confirming a
server and subscribing it to events are independent, and `status: "ok"` coexists with every event
flag at `0` — a silent no-delivery state. Provisioning must call `groups.setCallbackSettings`.
None of this bears on the prod host: a tunnel is reachable by construction, so the deciding test —
«Подтвердить» aimed at the prod host — is still unrun.

**Why this matters.** ADR 0006's relay exists for exactly one reason: the prod host filtered
inbound webhook delivery from Telegram's servers. Long poll has no inbound leg — both the API calls
and the poll are outbound HTTPS to `api.vk.ru` — so a VK transport can live entirely inside the Nuxt
app, as a Nitro plugin holding the loop, next to the existing sweeper in `server/plugins/telegram.ts`.
No second relay, no second bearer secret, no `ingest.post.ts` equivalent.

**Measured from the prod host on 2026-08-26, and it holds.** Note that the poll does _not_ go to
`api.vk.ru`: `groups.getLongPollServer` returns a different host, `https://lp.vk.ru/whp/<group_id>`,
so both had to be checked. `api.vk.ru/method/utils.getServerTime` → `200` via `87.240.137.206`;
`lp.vk.ru` → `403` on its bare root via `95.213.56.4` (correct — the endpoint needs its path and
query; the point is that it answered rather than hung). Both resolved to **IPv4**, which is exactly
where `api.telegram.org` failed: IPv6-only with no working v6 egress. Nothing on the VK side is
filtered outbound, so the no-relay conclusion is empirical now, not optimism.

The single-instance caveat carries over unchanged and is if anything softer: two app instances
polling with the same `key` would split updates between them, the same class of problem as two
instances fighting over `setWebhook`. Fine for the current deploy.

## 7. Rate limits and account requirements

- **Community setup:** a community (group/public/event); Управление → Сообщения → Настройки для
  бота → «Возможности ботов» enabled; messages enabled in Управление → Сообщения
  ([bots quick start](https://dev.vk.com/en/api/bots/getting-started)).
- **Token:** Управление → Работа с API → Создать ключ, with rights checked. We need `messages`
  (send/receive), plus `photos` and `docs` for attachments
  ([access rights](https://dev.vk.com/en/reference/access-rights)). Passed as
  `Authorization: Bearer <token>`; `v` is mandatory on every call (5.131 is what dev.vk.ru's own
  console runs; the community Long Poll settings offer up to 5.199 — but note that dropdown
  versions the _events_, independently of the `v` on our method calls). "Keys should not be posted publicly" — same handling as the bot token, i.e. it lives in
  runtime config only.
- **Rate:** "The Community Access Key — 20 requests per second"
  ([query format](https://dev.vk.com/en/api/api-requests), repeated in the
  [bot docs](https://dev.vk.com/en/api/bots/development/messages)). Exceeding it returns error `6`.
  Quantitative per-method limits exist but "We do not provide information about the exact limits";
  exceeding them can trigger a captcha. At friend-group volume (a handful of notifications an hour)
  this is not a constraint. If it ever is: `user_ids` groups up to 100 recipients of an identical
  message into one call, and `execute` batches up to 25 method calls.
- **Can the bot message a user who never wrote first?** Not without consent — that is what
  `901` enforces. Our linking flow makes the user write first, which the docs treat as consent
  "without time limits".
- **Platform rule worth flagging:** [Bots Rules](https://dev.vk.com/en/bots-rules) item 8 — "When
  sending messages that include user-generated content, passing the content's source is required",
  naming "bots that help users communicate with each other" as the example case. That is exactly
  what this bot does. `content_source` accepts either
  `{"type":"message", owner_id, peer_id, conversation_message_id}` (a VK-side message) or
  `{"type":"url", "url": "…"}`. We have no VK-side source, and a URL into a private app is not
  meaningfully verifiable. Low practical risk for a closed friend group, but it is a documented
  requirement we would be technically out of compliance with.

## 8. Privacy invariant

VK's stored identifier is the `peer_id`, and for a personal dialog `messages.send` documents it as
"For user: User ID, e.g. 12345" — i.e. the same integer as `vk.com/id12345`, a public profile. A
Telegram `chat_id` is opaque and scoped to one bot; a VK `peer_id` is a public handle. ADR 0006's
invariant ("never in `memberDto`, never in the session cookie") therefore has to hold at least as
strictly, and leaking one is worse: it deanonymizes the member to anyone who reads it. The derived
public boolean (`telegramNotifications` → a per-transport equivalent) is still safe, since it
exposes reachability, not identity. The link token still travels through a URL the user opens in a
browser, the same exposure class as `t.me/…?start=`.

## What would have to change in this codebase

**Nothing in the delivery _logic_** — the shape of `notifyOffline` is right. What is wrong is that
every layer names Telegram.

1. **`notifyOffline` splits into a builder and a transport loop.**
   `server/utils/telegram.ts:153` currently resolves recipients, filters by presence, builds the
   header + `plainTextBody`, resolves attachment object keys, and _then_ hardcodes the Telegram send
   sequence. Everything up to the send is transport-agnostic and should move to a new
   `server/utils/notify.ts` that produces `{text, media[]}` once and hands it to each configured
   transport behind an interface like
   `{ configured(): boolean; send(link, payload): Promise<{ids: number[]; blocked: boolean}> }`.
   `server/utils/messages.ts:197` keeps its single fire-and-forget call.
   The four-step caption-recovery dance (steps 1–4 in `notifyOffline`) is Telegram-specific and
   stays inside the Telegram transport — VK sends text and attachments in one call.

2. **The member columns become a per-transport table.** `telegram_chat_id`,
   `telegram_notifications_enabled`, `telegram_link_token`, `telegram_link_token_expires_at` on
   `members` (`server/db/schema.ts:34-38`) doubling into `vk_*` is the wrong answer twice over.
   Replace with `member_notification_links(id, member_id, transport, external_id,
notifications_enabled, link_token, link_token_expires_at)`, unique on `(member_id, transport)`
   and on `(transport, link_token)`. Migration backfills one row per linked member.

3. **The mapping table needs a second id column, so it is not a rename.**
   `telegram_notifications` keys on `(chat_id, telegram_message_id)`. VK has two id spaces and the
   docs do not say which one comes back on a reply (§3), so the generalized
   `notification_deliveries(id, transport, member_id, peer, external_message_id,
external_conversation_message_id, channel_id, created_at)` must let a lookup match _either_.
   Keep the unique index per `(transport, peer, external_message_id)`. The 7-day sweep in
   `server/plugins/telegram.ts` generalizes as-is.

4. **`messages.source` gains a value.** `schema.ts:95` (`enum: ['app','telegram']`) and
   `shared/types/dto.ts:46` both need `'vk'`, plus wherever the UI renders the source badge.

5. **`memberDto` gains a sibling field.** `server/utils/members.ts:20` derives
   `telegramNotifications`; `server/utils/dm.ts:58` selects the column for `DmConversationDto`.
   Either add `vkNotifications: boolean` or, better, a `notifications: { telegram: boolean; vk:
boolean }` object — the second is a breaking DTO change but stops this recurring. Every
   `member.updated` broadcast site in the VK code path has to fire the same way the Telegram ones do
   (link, unlink, toggle, auto-unlink).

6. **The four `/api/me/telegram/*` routes become `/api/me/notifications/[transport]/*`**
   (`index.get`, `index.patch`, `link-token.post`, `unlink.post`), validating `transport` against
   the enum. `link-token.post` returns the transport-appropriate deep link target — a bot username
   for Telegram, a community screen name for VK.

7. **`SettingsNotifications.vue` extracts a provider card.** The Telegram block (lines ~35-80 plus
   the `tg` reactive state and its three handlers) becomes a component rendered once per transport,
   with Russian copy per provider. Both flows end in a Start tap, so the copy can stay close —
   unless the spike shows `ref` does not survive the «Начать» press, in which case VK's card has to
   instruct the user to send a message.

8. **No second relay. No ingest route.** With Bots Long Poll the inbound path is a Nitro plugin
   (`server/plugins/vk.ts`) running the poll loop and calling a plain
   `handleVkUpdate(update)` function. Keep that function free of `H3Event` so a Callback API route
   can be bolted on later without moving logic — the event payloads are identical between the two
   transports. Watch the dev-server case: the loop must be torn down on HMR/`close` or reloads will
   stack pollers.

9. **New runtime config** (`NUXT_` prefix, per repo convention): `NUXT_VK_GROUP_ID`,
   `NUXT_VK_TOKEN` (community token, server-only), `NUXT_PUBLIC_VK_GROUP_SCREEN_NAME` for building
   `vk.me/<name>?ref=<token>`. Feature is a no-op when unset, mirroring `telegramConfigured()`.

10. **A transcoding step for voice notes**, or a documented downgrade to `doc`. See §4.

Rough order: schema + DTO generalization first (mechanical, touches the most files), then the
transport interface, then the VK transport itself, then the settings UI.

## Open questions / what the docs don't answer

Four of these were closed by the 2026-08-26 spike; they are kept here, struck through, so the record
shows what was unknown and what settled it.

1. ~~**Does `message_new` carry `reply_message` in a 1:1 user↔community dialog, and what is inside
   it?**~~ **Closed:** yes, with seven populated fields — see §3.
2. ~~**Which id comes back on a reply — `id`, `conversation_message_id`, or both?**~~ **Closed:**
   both, and both matched the probe. Still open in a narrower form: the test dialog was new enough
   that the two counters had not diverged, so "may be absent in some cases" remains untested.
3. ~~**Do all VK clients offer "Ответить" on a community's message inside a personal dialog?**~~
   **Closed for web and Android** — both produced identical `reply_message` objects. Other clients
   (iOS, desktop app) untested.
4. **When is `ref` actually delivered?** Partly closed: it _is_ delivered on the «Начать» press that
   opens a fresh dialog. Still unknown for every message from that link, and for the relink case
   where a conversation with the community already exists.
5. **Which `attachment` prefix does an uploaded voice message need** — `audio_message`, `doc`, or
   the `audio` used in VK's own example? Three VK pages disagree.
6. **Which error code fires when a user has pressed "запретить сообщения"** — `900` or `901` — and
   is `message_deny` guaranteed to be delivered before the next send fails?
7. **Can a community token upload video at all?** The rights table has no `video` entry; the docs
   never state the negative outright.
8. ~~**Is `api.vk.ru` reachable from the cloud.ru VPS?**~~ **Closed:** yes, and so is `lp.vk.ru`,
   the separate host the poll actually goes to — both over IPv4, both answering rather than
   hanging. See §6. Still open in the other direction: whether VK's servers can reach the prod
   host, which only matters if Callback is ever chosen over long poll.
9. **Exact quantitative (non-per-second) limits.** VK states outright: "We do not provide
   information about the exact limits."

## VK Teams as an alternative

[VK Teams](https://teams.vk.com/botapi/) is VK's corporate messenger and its Bot API is a much
closer structural match to Telegram's — the OpenAPI spec at
`https://teams.vk.com/botapi/api.yaml` shows `/messages/sendText` (with `replyMsgId`,
`forwardChatId`, `forwardMsgId`, `parseMode`), `/messages/sendFile`, `/messages/sendVoice`
(accepting **aac, ogg, m4a** — no sample-rate constraint, unlike VK Messenger), `/messages/editText`,
`/files/getInfo`, and `/events/get` with `lastEventId` + `pollTime`, i.e. outbound long polling with
Telegram-style `offset` semantics. Decisively for item 3, the spec defines an `eventNewMessageReply`
part whose payload is `message: {from, msgId, text, format, timestamp}` — the reply reference is a
first-class, documented field, which is exactly what VK Messenger's docs will not commit to.

It is still the wrong choice here. VK Teams is an organization-scoped product (chats, org members,
admin roles); the friend group would each need to install a corporate messenger nobody uses, which
defeats the "most Members already have it" premise that made Telegram worth building in ADR 0006.
Its deep-link/`/start`-token story is also not described in the API spec. Worth remembering only if
VK Messenger's reply spike (§3) comes back negative _and_ someone still wants a second transport.

## Sources

All accessed 2026-08-26. `dev.vk.com` serves server-rendered HTML and was reachable via plain HTTP;
the English pages are machine-translated from Russian and say so, so exact field, method, and error
names were taken from the code blocks and tables rather than the prose.

Primary — VK for developers (dev.vk.com):

- Chatbots quick start — https://dev.vk.com/en/api/bots/getting-started
- Chatbots / Development / Messages — https://dev.vk.com/en/api/bots/development/messages
- Community Messages — https://dev.vk.com/en/api/community-messages/getting-started
- Community Events (event list & object shapes) — https://dev.vk.com/en/api/community-events/json-schema
- Callback API — https://dev.vk.com/en/api/callback/getting-started
- Bots Long Poll API — https://dev.vk.com/en/api/bots-long-poll/getting-started
- Query format, headers, rate limits — https://dev.vk.com/en/api/api-requests
- Access rights (user and community keys) — https://dev.vk.com/en/reference/access-rights
- Error codes (general) — https://dev.vk.com/en/reference/errors
- Message object — https://dev.vk.com/en/reference/objects/message
- Message attachments — https://dev.vk.com/en/reference/objects/attachments-message
- `messages.send` — https://dev.vk.com/en/method/messages.send
- `messages.isMessagesFromGroupAllowed` — https://dev.vk.com/en/method/messages.isMessagesFromGroupAllowed
- `messages.allowMessagesFromGroup` — https://dev.vk.com/en/method/messages.allowMessagesFromGroup
- `messages.getByConversationMessageId` — https://dev.vk.com/en/method/messages.getByConversationMessageId
- `groups.getLongPollServer` — https://dev.vk.com/en/method/groups.getLongPollServer
- `photos.getMessagesUploadServer` — https://dev.vk.com/en/method/photos.getMessagesUploadServer
- `docs.getMessagesUploadServer` — https://dev.vk.com/en/method/docs.getMessagesUploadServer
- Upload overview — https://dev.vk.com/en/api/upload/overview
- Photo upload to private message — https://dev.vk.com/en/api/upload/photo-in-message
- Document upload — https://dev.vk.com/en/api/upload/document-in-profile
- Voice message upload — https://dev.vk.com/en/api/upload/audio-record
- Video upload — https://dev.vk.com/en/api/upload/video-in-profile
- VK Bridge `VKWebAppAllowMessagesFromGroup` — https://dev.vk.com/en/bridge/VKWebAppAllowMessagesFromGroup
- Allow Community Messages widget — https://dev.vk.com/en/widgets/allow-messages-from-community
- Bots Rules — https://dev.vk.com/en/bots-rules

Secondary — VK's own GitHub org, machine-readable schema rather than documentation. Used only where
dev.vk.com is silent, and labelled as such in the text:

- `VKCOM/vk-api-schema` `messages/objects.json` (stands in for the undocumented `reply_message`
  shape) — https://github.com/VKCOM/vk-api-schema/blob/master/messages/objects.json
- `VKCOM/vk-api-schema` `errors.json` (stands in for canonical error identifiers such as
  `api_error_messages_deny_send`) — https://github.com/VKCOM/vk-api-schema/blob/master/errors.json

VK Teams:

- Bot API docs and OpenAPI spec — https://teams.vk.com/botapi/ and https://teams.vk.com/botapi/api.yaml
