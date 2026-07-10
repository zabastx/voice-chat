# Progress & Plan

Status of the personal Discord clone (Nuxt 4 + @nuxt/ui). Plan approved via grilling session,
built end-to-end, live on the VPS.

## Product decisions (locked)

| Decision      | Choice                                                                                                                                                                                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI language   | **Russian** (`lang="ru"`, `ru` UApp locale)                                                                                                                                                                                                                      |
| Voice scale   | 2–5 concurrent participants                                                                                                                                                                                                                                      |
| Media         | Self-hosted **LiveKit** SFU — screen share needs an SFU ([ADR 0001](adr/0001-self-hosted-livekit-sfu.md))                                                                                                                                                        |
| Structure     | One space, flat channel list; each channel `text` or `voice`; no guilds                                                                                                                                                                                          |
| Roles         | **Admin** (first account) > **Moderator** > **Member** — single `role` enum, no permissions engine ([ADR 0002](adr/0002-db-checked-role-guards.md))                                                                                                              |
| Auth          | Single-use invite links → username + password; cookie sessions; no email/reset (admin resets)                                                                                                                                                                    |
| Chat v1       | Persistent history, image/file attachments, edit & delete own (admin deletes any)                                                                                                                                                                                |
| Attachments   | External **S3-compatible bucket** via aws4fetch; presigned GETs; nothing on VPS disk                                                                                                                                                                             |
| Database      | **Postgres 18** (Drizzle + postgres.js); was SQLite in v1 — [ADR 0004](adr/0004-postgres-replaces-sqlite.md) (v0.12.0)                                                                                                                                           |
| Platform      | Responsive web + installable PWA; voice-activity detection (no push-to-talk)                                                                                                                                                                                     |
| Deploy        | docker compose to a rented VPS with a domain; ships its own Caddy for auto-HTTPS                                                                                                                                                                                 |
| Notifications | In-app (unread badges, tab-title counter, sounds) + opt-in **Telegram bridge** for offline mentions/DMs with reply-to-send (v0.14.0, [ADR 0006](adr/0006-telegram-notifications.md)); v0.15.0 forwards attachments + clickable links, badges Telegram replies «через Telegram» ([ADR 0007](adr/0007-message-source.md)) |

**Deferred to v2+:** browser/Web Push, desktop wrapper / global PTT, multiple spaces, a real roles
engine, rich link previews (M6 — SSRF/privacy). Already un-deferred: Postgres (v0.12.0), 1:1 DMs
(v0.13.0, [ADR 0005](adr/0005-direct-messages-as-channel-rows.md)).

## v2 — Chat/messaging (M1–M5 shipped as v0.3.0–v0.7.0)

| Milestone                        | Notes                                                                   |
| -------------------------------- | ----------------------------------------------------------------------- |
| M1 — Markdown + autolinks        | `app/utils/markdown.ts` (markdown-it + DOMPurify); `.chat-prose`        |
| M1 — jump-to-message foundation  | `aroundId=` window + client `jumpToMessage` + flash                     |
| M2 — @mentions                   | `shared/utils/mentions.ts`, composer autocomplete, chip + ping          |
| M3 — Replies                     | `replyToId` (no FK), reply banner, quote render, deleted-live           |
| M4 — Reactions                   | `reactions` table, toggle endpoint, emoji-picker-element, chips         |
| M5 — Message search (full-text)  | `/api/search`, SearchModal + jump; FTS5 → Postgres tsvector in v0.12.0  |

M6 (rich link previews) stays deferred; URLs are clickable via M1 autolink.

## Feature status

| Area                                                              | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth, invites, first-user-admin                                   | ✅ done     | `server/api/auth/*`, `server/api/invites/*`                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Channels CRUD (admin)                                             | ✅ done     | live-synced over WS                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Moderator role (invites + channel create/rename)                  | ✅ done     | v0.10.0: `role` enum, DB-checked `requireRole` ([ADR 0002](adr/0002-db-checked-role-guards.md)), promote/demote in ManageModal, live session refresh; verified via API + two-browser Playwright                                                                                                                                                                                                                                                                             |
| Text chat: send/edit/delete, unread, day separators, grouping     | ✅ done     | `app/pages/channels/[id].vue`; message list windowed to ~150 DOM nodes around the viewport. v0.15.1: own-message echo no longer badges unread when tab unfocused — stores mirror the author's read cursor from `event.message.createdAt` (server persists it in `createChannelMessage`) instead of gating on `document.hasFocus()`                                                                                                                                          |
| Realtime hub (presence, messages, channels, voice state)          | ✅ done     | `server/utils/ws-hub.ts`, `server/routes/_ws.ts`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Attachments (S3 upload, presigned serve, auth-gate, cleanup)      | ✅ done     | `server/utils/storage.ts`, `server/api/attachments/*`; `?proxy` streams bytes for JS readers (voice waveform — no bucket CORS); `?preview` serves a sharp WebP thumbnail (`image-preview.ts`)                                                                                                                                                                                                                                                                               |
| Voice channels (join/leave, mute, speaking, roster)               | ✅ done     | `useVoice.ts` + LiveKit webhooks                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Per-speaker local volume/mute (right-click, Discord-style)        | ✅ built    | client-side only, per-device in `usePreferences` (`localVolumes`); `VoiceUserMenu.vue` on sidebar rows + call tiles ([ADR 0003](adr/0003-client-side-local-volume.md)); **needs verify**                                                                                                                                                                                                                                                                                    |
| Screen share (publish, tile in call view)                         | ✅ done     | video verified on desktop; viewer merged into `ChannelVoice.vue`                                                                                                                                                                                                                                                                                                                                                                                                            |
| Camera video calls (in-channel call view, tiles + focus)          | ✅ built    | fixed-size wrapped tiles (object-contain); camera re-enable fixed via TrackMuted/TrackUnmuted tile rebuild (mute reuses the element's MediaStream without replaying → black feed); **needs verify**                                                                                                                                                                                                                                                                         |
| Sounds, tab-title counter                                         | ✅ done     | `app/utils/sounds.ts`, `useHead` in layout                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| PWA (manifest + icons)                                            | ✅ done     | `public/manifest.webmanifest`, `public/icon-*.png`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Russian localization (UI + server errors)                         | ✅ done     | server errors in `message` field                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Deploy stack (Dockerfile, compose, Caddy, livekit.yaml)           | ✅ deployed | live on the VPS; see [DEPLOY.md](DEPLOY.md)                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| User settings (profile, voice/video devices, notifications)       | ✅ done     | `SettingsModal.vue`, `server/api/me/*`, prefs in localStorage                                                                                                                                                                                                                                                                                                                                                                                                               |
| Versioning + changelog («Что нового», badge on new version)       | ✅ done     | `app/data/changelog.ts`, `useChangelog.ts`, `ChangelogModal.vue`                                                                                                                                                                                                                                                                                                                                                                                                            |
| Postgres 18 migration (schema, driver, search, ETL)               | ✅ built    | v0.12.0, [ADR 0004](adr/0004-postgres-replaces-sqlite.md); verified locally end-to-end incl. ETL rehearsal on the real dev DB; **prod cutover pending** — DEPLOY.md "Migrating an existing SQLite deployment"                                                                                                                                                                                                                                                               |
| Direct messages (1:1, private)                                    | ✅ built    | v0.13.0, [ADR 0005](adr/0005-direct-messages-as-channel-rows.md); DM = `kind='dm'` channel + `channel_participants`; `requireChannelMember` gate + targeted `emitChannelEvent`; get-or-create `/api/dm`, `useDmStore`, reuses `ChannelChat`; gates green — **two-client verify pending**                                                                                                                                                                                    |
| Telegram notifications (offline mentions/DMs + reply-to-send)     | ✅ built    | v0.14.0 base ([ADR 0006](adr/0006-telegram-notifications.md)): deep-link `/start` linking, per-notification mapping for replies, auto-unlink on 403, 7-day sweep. v0.15.0: `source: app\|telegram` on `messages` (set-once, [ADR 0007](adr/0007-message-source.md), migration `0003_rapid_karma.sql`) → «через Telegram» badge; `notifyOffline` forwards attachments (voice/photo/video/document) via relay `POST /sendMedia` multipart (app fetches S3 → relay → Telegram), text-as-caption ≤1024 else separate `sendMessage`, `plainTextBody` strips markdown keeping bare URLs, silent-fail hints «(не удалось переслать вложение)». v0.16.0: derived `memberDto.telegramNotifications` boolean (linked AND enabled) powers the icon in `MembersPanel.vue`, live via `member.updated`; raw chat id + link token stay secret. Delivery via standalone `telegram-relay/` (prod host filters Telegram — gotcha #20). Key files: `server/utils/telegram.ts`, `server/api/telegram/ingest.post.ts`, `server/api/me/telegram/*`, `app/components/ChatMessage.vue`. Gates green — **needs relay deployed to verify end-to-end** |

## Verification matrix

**Verified locally** (two parallel Playwright browser profiles + real MinIO S3):

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
- Settings modal: display name propagates live (old messages/SelfPanel), avatar
  upload→MinIO→presigned (5 render sites), wrong-password 400, mic level meter,
  localStorage prefs, Esc close

**Verified on the deployed VPS:** screen-share video between two real desktop browsers; the live
`docker compose up` stack itself.

**v0.9.1 security/perf hardening** (verified locally, dev server + MinIO):

- Session revalidation middleware ([session-member.ts](../server/middleware/session-member.ts)):
  deleting a member revokes their session (channels/voice-token/ws-ticket → 401); public routes
  still work with a stale cookie
- Login + register rate-limited (10 / 15 min per IP, [rate-limit.ts](../server/utils/rate-limit.ts)) — 429 verified
- Register in a single transaction — invite can't be consumed twice (400 on reuse)
- Non-media uploads forced to download on redirect and `?proxy` paths
  (`Content-Disposition: attachment` + nosniff) — doesn't render inline
- Chunked upload without Content-Length → 411; Caddy `request_body max_size 30MB` + security headers
- S3 objects (incl. WebP previews) deleted with channel/member deletion, not just rows
- Channel-list query → correlated index-seek subquery; new indexes on `attachments.message_id`
  and `messages.reply_to_id`
- Hourly stale-upload sweep (was boot-only); redirects carry `Cache-Control: private, max-age=240`;
  WS ticket-map purge + 10 s auth timeout
- Pagination cursor id tiebreaker (`before` + `beforeId`) — same-millisecond rows not skipped

**v0.9.2 message virtualization** (real browser, 400-message-seeded channel): DOM held at ~150
nodes scrolling both directions, scroll position anchored across every load/trim, no console
errors; reached the true top and returned to the live tail re-pinned; jump-to-message loads an
around-window + flash, scrolling down reloads newer. Server gained `after`/`afterId` forward
cursor + `hasMoreNewer`.

**v0.10.0 moderator role** (verified locally): 18-check API smoke passes — member 403s; a
pre-promotion cookie works immediately after promote; channel delete / password reset / role
change stay 403 for moderators; admin role immutable (400); demotion cuts powers on the next
request. Migration on a dev-DB copy: `is_admin` dropped, roles mapped. Two browsers: promote/demote
flips maks's UI live (buttons, dropdown, manage modal read-only roster, «модератор» badge both clients).

**v0.12.0 Postgres migration** (verified locally, `postgres:18-alpine`): fresh-DB boot applies
baseline + seeds admin/`#general`/`lounge`; two parallel registrations on empty DB → exactly one
admin (`pg_advisory_xact_lock`), invite create→use→reuse-400 re-verified; tsvector Russian stemming
(«книга» finds «книгу»), multi-term AND, Latin prefix match; ETL rehearsal on the real dev SQLite —
all counts match, roles/timestamps intact, migrated login works, tsvector self-populated, re-run
refused on non-empty target; Bun-dev WS gotcha re-tested before locking the driver (still broken).

**v0.16.0 Telegram icon** (two Playwright browsers): linking maks + reload → icon with tooltip
«Получает уведомления в Telegram» in both member sections; toggle off/on and unlink each flip the
icon live in danil's panel via `member.updated`; `GET /api/members` returns exactly old DTO keys +
`telegramNotifications` (no chat id / token); malformed PATCH → clean 400. Not driven: real
`/start` deep-link (needs relay + bot); shares the broadcast code path.

**Not yet verified (needs a human / real environment):**

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
- Real NAT traversal — voice from two different networks (phone hotspot vs home Wi-Fi)
- Mobile browsers (esp. iOS Safari voice)
- Production Caddy: `request_body`/`header` blocks parse on the live VPS
- Production Postgres cutover on the VPS (DEPLOY.md "Migrating an existing SQLite deployment")

## Remaining work / next steps

1. **Postgres cutover on the VPS** — follow DEPLOY.md; back up the SQLite file first; afterwards
   remove the legacy `app-data` volume in a follow-up change.
2. **Test real NAT traversal** — voice from two different networks.
3. **Test on mobile browsers**, especially iOS Safari voice.
