# Verification matrix

Evidence for the ✅ rows in [features.md](features.md): what was actually driven, where, and what
it proved. The last section lists what is still **not** verified. Part of
[PROGRESS.md](../PROGRESS.md).

## Verified locally

Two parallel Playwright browser profiles + real MinIO S3:

- Invite gating, first-user-admin, login/logout, admin-only 403s
- Chat send/edit/delete live-sync between two clients; unread + read tracking
- Attachments: upload to real S3, presigned serving, 401 logged out, raw-bucket 403 (private),
  object deleted with its message
- **Voice audio actually flowing** between two browsers (mic track subscribed + `<audio>` attached);
  roster visible to a non-participant (webhook → voice-state → WS); mute relay
- Russian SSR renders (login page, sidebar, timestamps)
- **Production bundle** built exactly as the Dockerfile does, smoke-tested under Bun: migrations,
  WS, upload+presign, Russian SSR
- **M1 markdown**: right tags for bold/italic/strike/code/autolink; `<script>`, `javascript:` links,
  `<img onerror>` all inert; no hydration mismatch
- **M2 @mentions**: autocomplete filters + inserts, `@name`→`<@id>` encode, live-name chip;
  round-trips incl. Cyrillic, longest-match wins, `a@danil` not a mention
- **M3 replies**: quoted parent (author + decoded preview), click scrolls + flashes, deleted parent
  → «исходное сообщение удалено» live and after reload
- **M4 reactions**: quick-react chip with count + "me" styling, `<emoji-picker>` upgrades,
  chip click toggles off
- **M5 search**: ranked results with `<mark>` (incl. Cyrillic query), click jumps + flashes,
  index stays live on insert/delete
- **v0.17.1 live newcomer**: with danil's tab open and never reloaded, registering `novichok`
  through an invite in a second browser flips the members panel to «В сети — 2» with the new row
  (was: absent from both sections until F5). Blast radius of the missing broadcast was everything
  sourced from the client member directory — panel row, chat avatar, `@` autocomplete, DM picker;
  chat author name and the DM sidebar row were never affected (they read `message.authorName` and
  the server-embedded `convo.member`)
- **v0.17.2 live removal**: with maks parked _inside_ the DM and never reloaded, danil deleting
  `udalyaemyi` drops them from the panel («В сети — 3» → «2»), removes the DM row, and bounces maks
  to the first text channel; the removed member's own tab flips to «подключение…» and its
  `/api/ws/ticket` + `/api/dm` both 401
- **v0.17.3 message purge**: `boltun` posts 4 messages in #general, maks replies to one and
  `boltun` reacts to that reply. Deleting `boltun` clears all four posts from maks's never-reloaded
  tab, flips the surviving reply's quote to «исходное сообщение удалено» and drops the 👍 chip —
  the last two are the cases local `authorId` filtering provably cannot reach
- **v0.18.1 auth form validation**: tabbing through empty fields on `/login` and `/register` no longer
  paints them red; submitting empty shows the Russian schema messages (was the zod default
  «Invalid input: expected string, received undefined», because `UAuthForm` seeds state from
  `field.defaultValue`, i.e. `undefined`); typing clears that field's error live after 300 ms
- **v0.19.0 YouTube embeds**: `watch?v=…&t=30` renders a 446x251 card and click-to-play navigates a
  `youtube-nocookie` iframe with `start=30`; a real Short renders 198x352 with the vertical frame
  filling it; `<https://youtu.be/…>` and a link inside a code span both render with no card;
  «Смотреть вместе» is absent outside a voice channel and, from inside `lounge`, starts a real
  synced session on that video (mini player docked, TV badge on the channel row)
- **Crawler blocking**: against the running dev server, `/login` and `/robots.txt` both carry
  `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai`
  and the SSR HTML carries the matching `<meta name="robots">`. The **real** `deploy/Caddyfile` was
  then run in a `caddy:2` container (`caddy validate` green, `DOMAIN=localhost`): `GPTBot`,
  `ClaudeBot`, `CCBot`, `meta-externalagent` and `AhrefsBot` get **403**, while a browser UA, `curl`,
  `TelegramBot` **and `GPTBot` asking for `/robots.txt`** all fall through to the proxy instead —
  502 there only because `app:3000` doesn't exist in the test container, which is exactly what
  proves the request was routed rather than blocked. The security `header` block still applies to
  the 403 responses
- Settings modal: display name propagates live (old messages/SelfPanel), avatar
  upload→MinIO→presigned (5 render sites), wrong-password 400, mic level meter,
  localStorage prefs, Esc close

## Verified on the deployed VPS

Screen-share video between two real desktop browsers; the live `docker compose up` stack itself.

## v0.9.1 security/perf hardening

Verified locally, dev server + MinIO:

- Session revalidation middleware ([session-member.ts](../../server/middleware/session-member.ts)):
  deleting a member revokes their session (channels/voice-token/ws-ticket → 401); public routes
  still work with a stale cookie
- Login + register rate-limited (10 / 15 min per IP, [rate-limit.ts](../../server/utils/rate-limit.ts)) — 429 verified
- Register in a single transaction — invite can't be consumed twice (400 on reuse)
- Non-media uploads forced to download on redirect and `?proxy` paths
  (`Content-Disposition: attachment` + nosniff) — doesn't render inline
- Chunked upload without Content-Length → 411; Caddy `request_body max_size 30MB` + security headers
- S3 objects (incl. WebP previews) deleted with channel/member deletion, not just rows. Member
  deletion also takes their `kind='dm'` channels (the `channels` row has no member FK, so those
  survived every deletion with one participant — invisible via `dmConversationDto`'s null, but
  accumulating). The S3 sweep covers both participants: dropping the channel cascades the
  **surviving** member's messages away too, and their attachment keys are not in the `uploader_id`
  query. Verified with a file uploaded from each side — both left the bucket, DB rows and MinIO
  objects still 5/5 in sync afterwards
- Channel-list query → correlated index-seek subquery; new indexes on `attachments.message_id`
  and `messages.reply_to_id`
- Hourly stale-upload sweep (was boot-only); redirects carry `Cache-Control: private, max-age=240`;
  WS ticket-map purge + 10 s auth timeout
- Pagination cursor id tiebreaker (`before` + `beforeId`) — same-millisecond rows not skipped

## v0.9.2 message virtualization

Real browser, 400-message-seeded channel: DOM held at ~150 nodes scrolling both directions, scroll
position anchored across every load/trim, no console errors; reached the true top and returned to
the live tail re-pinned; jump-to-message loads an around-window + flash, scrolling down reloads
newer. Server gained `after`/`afterId` forward cursor + `hasMoreNewer`.

## v0.10.0 moderator role

Verified locally: 18-check API smoke passes — member 403s; a pre-promotion cookie works immediately
after promote; channel delete / password reset / role change stay 403 for moderators; admin role
immutable (400); demotion cuts powers on the next request. Migration on a dev-DB copy: `is_admin`
dropped, roles mapped. Two browsers: promote/demote flips maks's UI live (buttons, dropdown, manage
modal read-only roster, «модератор» badge both clients).

## v0.12.0 Postgres migration

Verified locally, `postgres:18-alpine`: fresh-DB boot applies baseline + seeds
admin/`#general`/`lounge`; two parallel registrations on empty DB → exactly one admin
(`pg_advisory_xact_lock`), invite create→use→reuse-400 re-verified; tsvector Russian stemming
(«книга» finds «книгу»), multi-term AND, Latin prefix match; ETL rehearsal on the real dev SQLite —
all counts match, roles/timestamps intact, migrated login works, tsvector self-populated, re-run
refused on non-empty target; Bun-dev WS gotcha re-tested before locking the driver (still broken).

## v0.16.0 Telegram icon

Two Playwright browsers: linking maks + reload → icon with tooltip «Получает уведомления в Telegram»
in both member sections; toggle off/on and unlink each flip the icon live in danil's panel via
`member.updated`; `GET /api/members` returns exactly old DTO keys + `telegramNotifications` (no chat
id / token); malformed PATCH → clean 400. Not driven: real `/start` deep-link (needs relay + bot);
shares the broadcast code path.

## v0.17.0 screen-share preset dialog

**Pending verify.** Click `monitor-up` in call bar → `ShareSettingsModal` opens with default «Текст и
презентации»; select «Видео и игры» or «Без сжатия» → «Начать» → browser `getDisplayMedia` picker →
share tile appears for the remote peer; stop share → click again → dialog pre-fills the previous
preset (persisted in `Preferences.screenSharePreset`); cancel at dialog or browser picker leaves
`sharing=false` with no spurious toast; sidebar `VoicePanel.vue` opens the same modal.

## v0.18.0 Watch Together

Two headed Chromium profiles, real YouTube, real LiveKit — 2026-07-30:

- URL handling: `youtube.com/watch?v=`, `youtu.be/…?t=200` (offset honoured — both clients opened at
  `start=200`), `&t=` on the long form; a Twitch link is refused **at the modal** with «Не похоже на
  ссылку YouTube», `aria-invalid` and an error ring, without a round trip
- Both clients render their own iframe at full stage size (no 640×390 flash), and the `allow`
  attribute is the IFrame API's own list **including `autoplay`** — confirming the removed
  `setAttribute` was narrowing it
- Playback agreed within **0.6 s** at steady state; pause from maks froze danil within **0.04 s**;
  resume propagated with «Продолжаем · maks» (neutral phrasing, attributed to the actor, never to
  the observer) as a transient caption **on the player**, not an app-wide toast — re-verified after
  the change: caption present bottom-left, zero toasts, faded within ~2.5s
- **Seek propagates**: maks → 420 s pulled danil from 165 s to 434 s, delta **0.77 s**
- **Late joiner in sync**: maks left, video ran 25 s, maks rejoined **by clicking «Подключиться»**
  (not by reloading — reload takes the fresh `snapshot` path and hides the bug) → delta **1.89 s**,
  stable at 1.85–2.19 s over the next 30 s. Note the deadband is per-client-against-anchor, so two
  clients can legitimately sit up to ~2× tolerance apart
- **Empty room freezes and resumes exactly**: anchor stopped at `positionSec 118.9, paused true`
  the moment the roster hit zero, was **still** 118.9 after 30 s empty, and both clients resumed at
  `start=118` — proving the pause fires from `voiceParticipantLeft`, not LiveKit's 300 s `empty_timeout`
- Stop propagates to both clients with «Совместный просмотр остановлен»; player errors render the
  Russian failure state with a recovery button on both clients rather than a blank frame
- Sidebar «смотрят вместе» icon visible to a member who has **left** the room while others watch
- **Playback speed** syncs both ways (maks -> 2x pulled danil to 2x); at 2x both advance ~2s of
  video per wall second and the delta CONVERGES (3.02 -> 1.51 -> 1.13s) rather than running away —
  that is the rate-scaled drift test working, since unscaled every 3s tick at 2x fires a false
  seek broadcast that drags the room; caption «Скорость 1.5× · maks» confirmed on the observer
- **Mini player**: clicking through to #general kept the _same_ iframe element alive and playback
  continuous (37.5s -> 68.3s -> 75.0s, never restarting); docked 925x639 -> mini 320x180 pinned
  bottom-right; drag landed exactly on the expected pixel and persisted to `watchMiniPos`; a 2px
  press navigated back and re-docked to the identical box

Three defects were found only by driving it, all fixed and each written up in
[gotchas 18f–18h](../GOTCHAS.md): a detached watcher bound to a caller-scoped `computed` (rejoin
without reload → no player), `new YT.Player()` being touched before `onReady` (repeating throw →
stage mounted with no iframe), and the seek/drift discriminator needing to be asymmetric **and** not
having its baseline refreshed by `onStateChange` (seeks were being corrected away instead of
broadcast).

Two gaps found and **not** fixed: the sidebar `VoicePanel` has no «Смотреть вместе» button (screen
share is wired into both bars, this isn't), and there is no direct **replace** — the control-bar
button stops an active session, so changing video means stop-then-start even though the server
supports overwrite.

## Not yet verified (needs a human / real environment)

- **DMs end-to-end (v0.13.0)** — two clients: get-or-create idempotency from all four entry points,
  live targeted delivery + ping/desktop notification, non-participant 404 on messages + no WS leak,
  attachments/reactions/replies/edit/delete inside a DM, search excludes DMs, non-participant can't
  fetch a DM attachment, unread → title count
- **Telegram end-to-end (v0.14.0/v0.15.0)** — real bot token + relay: `/start` linking; offline
  @mention and offline DM each deliver exactly one notification (online → none); reply-to-send
  routes to the right channel/DM authored as the linked member; non-reply/media/expired-mapping
  hints; 403 auto-unlink; no chat-id/token leak in `member.updated` or `GET /api/members`.
  v0.15.0: Telegram reply gets the «через Telegram» badge (in-app send none); voice attachment →
  playable Telegram voice with caption; image + file → `sendPhoto` then `sendDocument`, each with
  its own mapping row; >1024 text → separate `sendMessage` then captionless media; all-media-fail →
  text recovered with «(вложение не удалось переслать)» / attachment-only → «(не удалось переслать
  вложение)»; markdown link arrives as clickable bare URL; `source` stays `app` for native sends
  and survives an in-app edit of a Telegram-origin message
- **Watch Together (v0.18.0)** — mostly ✅ verified, see the section above. Still not driven: a
  YouTube **live broadcast** (live-ness detection, no DVR seek-fighting), a **Shorts** URL
  end-to-end, an genuinely **embedding-disabled** video (the bogus-id path was driven instead), a
  real **buffering stall** not being rebroadcast, and mobile/iOS Safari.
- Real NAT traversal — voice from two different networks (phone hotspot vs home Wi-Fi)
- Mobile browsers (esp. iOS Safari voice) — for Watch Together specifically, that `playsinline`
  actually keeps the video in the filmstrip layout instead of forcing fullscreen
- Production Caddy: `request_body`/`header`/crawler-403 blocks parse on the live VPS. The config now
  validates and serves correctly in a local `caddy:2` container (same image as prod), so what's left
  is confirming it on the real host after a `docker compose up -d caddy`
- Production Postgres cutover on the VPS (DEPLOY.md "Migrating an existing SQLite deployment")
