# Progress & Plan

Status of the personal Discord clone. Started from a bare Nuxt 4 + @nuxt/ui scaffold; the plan
below was approved via a grilling session, built end-to-end, and is now deployed and running
on the VPS.

## Product decisions (locked)

| Decision      | Choice                                                                                                                                                                                  |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI language   | **Russian** (locked after initial build; `lang="ru"`, `ru` UApp locale)                                                                                                                 |
| Voice scale   | 2–5 concurrent participants                                                                                                                                                             |
| Media         | Self-hosted **LiveKit** SFU (screen share needs an SFU — see [ADR 0001](adr/0001-self-hosted-livekit-sfu.md))                                                                           |
| Structure     | One space, flat channel list; each channel is `text` or `voice`; no guilds                                                                                                              |
| Roles         | Three, strictly hierarchical: **Admin** (first account) > **Moderator** > **Member** — a single `role` enum, no permissions engine (see [ADR 0002](adr/0002-db-checked-role-guards.md)) |
| Auth          | Single-use invite links → username + password; cookie sessions; no email/reset (admin resets)                                                                                           |
| Chat v1       | Persistent history, image/file attachments, edit & delete own (admin deletes any)                                                                                                       |
| Attachments   | External **S3-compatible bucket** via aws4fetch; presigned GETs; nothing on VPS disk                                                                                                    |
| Database      | SQLite (Drizzle); one file on a volume                                                                                                                                                  |
| Platform      | Responsive web + installable PWA; voice-activity detection (no push-to-talk)                                                                                                            |
| Deploy        | docker compose to a rented VPS with a domain; ships its own Caddy for auto-HTTPS                                                                                                        |
| Notifications | In-app only: unread badges, tab-title counter, join/leave/message sounds                                                                                                                |

**Deferred to v2+:** browser/Web Push, desktop wrapper / global PTT, DMs, multiple spaces, a real
roles engine, Postgres. The **Chat/messaging** batch (markdown, @mentions, replies, reactions,
search) shipped as v0.3.0–v0.7.0 — see "v2 — Chat/messaging" below. Only rich link previews (M6)
remain deferred (SSRF/privacy).

## v2 — Chat/messaging

M1–M5 shipped; each was its own release. Rich link previews (M6) stay deferred (SSRF/privacy);
URLs are clickable via M1 autolink.

| Milestone                                  | Status  | Notes                                                            |
| ------------------------------------------ | ------- | ---------------------------------------------------------------- |
| M1 — Markdown (Discord subset) + autolinks | ✅ done | `app/utils/markdown.ts` (markdown-it + DOMPurify); `.chat-prose` |
| M1 — jump-to-message foundation            | ✅ done | `aroundId=` window + client `jumpToMessage` + flash              |
| M2 — @mentions                             | ✅ done | `shared/utils/mentions.ts`, composer autocomplete, chip + ping   |
| M3 — Replies                               | ✅ done | `replyToId` (no FK), reply banner, quote render, deleted-live    |
| M4 — Reactions                             | ✅ done | `reactions` table, toggle endpoint, emoji-picker-element, chips  |
| M5 — Message search (global FTS5)          | ✅ done | FTS5 + triggers in `db.ts`, `/api/search`, SearchModal + jump    |

## Feature status

| Area                                                              | Status      | Notes                                                                                                                                                                                                                          |
| ----------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Auth, invites, first-user-admin                                   | ✅ done     | `server/api/auth/*`, `server/api/invites/*`                                                                                                                                                                                    |
| Channels CRUD (admin)                                             | ✅ done     | live-synced over WS                                                                                                                                                                                                            |
| Moderator role (invites + channel create/rename)                  | ✅ done     | v0.10.0: `role` enum on members, DB-checked `requireRole` guards ([ADR 0002](adr/0002-db-checked-role-guards.md)), promote/demote in ManageModal, live session refresh; verified via API + two-browser Playwright              |
| Text chat: send / edit / delete, unread, day separators, grouping | ✅ done     | `app/pages/channels/[id].vue`; message list is windowed — a bounded ~150-message DOM around the viewport (scroll-up loads older + trims newest, scroll-down reloads newer + trims oldest)                                      |
| Realtime hub (presence, messages, channels, voice state)          | ✅ done     | `server/utils/ws-hub.ts`, `server/routes/_ws.ts`                                                                                                                                                                               |
| Attachments (S3 upload, presigned serve, auth-gate, cleanup)      | ✅ done     | `server/utils/storage.ts`, `server/api/attachments/*`; `?proxy` streams bytes for JS readers (voice waveform — bucket has no CORS); `?preview` serves a sharp-generated WebP thumbnail for in-chat images (`image-preview.ts`) |
| Voice channels (join/leave, mute, speaking, roster)               | ✅ done     | `useVoice.ts` + LiveKit webhooks                                                                                                                                                                                               |
| Per-speaker local volume/mute (right-click, Discord-style)        | ✅ built    | client-side only, persisted per-device in `usePreferences` (`localVolumes`); `VoiceUserMenu.vue` on sidebar rows + call tiles; see [ADR 0003](adr/0003-client-side-local-volume.md); needs verify                              |
| Screen share (publish, now a tile in the call view)               | ✅ done     | video verified on desktop; viewer merged into `ChannelVoice.vue`                                                                                                                                                               |
| Camera video calls (in-channel call view, tiles + focus)          | ✅ built    | fixed-size wrapped tiles (object-contain); camera re-enable fixed via TrackMuted/TrackUnmuted tile rebuild (mute reuses the element's MediaStream without replaying → black feed); needs verify                                |
| Sounds, tab-title counter                                         | ✅ done     | `app/utils/sounds.ts`, `useHead` in layout                                                                                                                                                                                     |
| PWA (manifest + icons)                                            | ✅ done     | `public/manifest.webmanifest`, `public/icon-*.png`                                                                                                                                                                             |
| Russian localization (UI + server errors)                         | ✅ done     | server errors in `message` field                                                                                                                                                                                               |
| Deploy stack (Dockerfile, compose, Caddy, livekit.yaml)           | ✅ deployed | live on the VPS; see [DEPLOY.md](DEPLOY.md)                                                                                                                                                                                    |
| User settings (profile, voice/video devices, notifications)       | ✅ done     | `SettingsModal.vue`, `server/api/me/*`, prefs in localStorage                                                                                                                                                                  |
| Versioning + changelog ("Что нового", badge on new version)       | ✅ done     | `app/data/changelog.ts`, `useChangelog.ts`, `ChangelogModal.vue`                                                                                                                                                               |

## Verification matrix

**Verified locally** (two parallel Playwright browser profiles + a real MinIO S3 endpoint):

- Invite gating, first-user-admin, login/logout, admin-only authorization (403s)
- Chat send/edit/delete live-syncing between two clients; unread + read tracking
- Attachment upload to a real S3 API, presigned serving, 401 when logged out, raw-bucket 403
  (private), object deleted when its message is deleted
- **Voice audio actually flowing** between two browsers (mic track subscribed + `<audio>` attached)
- Voice roster visible to a member NOT in the call (webhook → voice-state → WS broadcast), mute relay
- Russian SSR renders (login page, sidebar, timestamps)
- **Production bundle** built exactly as the Dockerfile does, smoke-tested under Bun: migrations
  run, WS works, upload+presign works, Russian SSR renders
- **M1 markdown** rendered in a real browser: bold/italic/strike/code/autolink produce the right
  tags; `<script>`, `javascript:` links, and `<img onerror>` all render inert (no dialogs); no
  hydration mismatch
- **M2 @mentions** in a real browser: composer `@` autocomplete filters + inserts, the server
  encodes `@name`→`<@id>`, the message renders a live-name chip; encode/decode round-trips
  (incl. Cyrillic usernames), longest-match wins, and `a@danil` is not treated as a mention
- **M3 replies** in a real browser: reply banner → sent reply shows the quoted parent (author +
  mention-decoded preview); clicking the quote scrolls to and flashes the original; deleting the
  parent flips the quote to "исходное сообщение удалено" both live and after reload
- **M4 reactions** in a real browser: quick-react adds a chip with count + "me" styling, the full
  `<emoji-picker>` web component registers/upgrades, and clicking a chip toggles the reaction off
- **M5 search** in a real browser: global FTS5 search returns ranked results with `<mark>` highlight
  (incl. a Cyrillic query), clicking a result jumps to + flashes the message, and the insert/delete
  triggers keep the index live (new message searchable immediately, deleted message drops out)
- Settings modal end-to-end: display name saves + propagates live to old messages/SelfPanel,
  avatar upload→MinIO→presigned serve (5 render sites), wrong-current-password 400, mic-test level
  meter, prefs persisted to localStorage, Esc close

**Verified on the deployed VPS:**

- Screen-share _video_ rendering between two real desktop browsers
- The actual VPS `docker compose up` — stack is live on the server

**Security / performance hardening (v0.9.1)** — verified locally against the dev server + MinIO:

- Session revalidation middleware ([server/middleware/session-member.ts](../server/middleware/session-member.ts)):
  deleting a member now revokes their sealed-cookie session (channels/voice-token/ws-ticket → 401);
  public routes (`/api/auth/*`, invite validity) still work with a stale cookie
- Login + register rate-limited (10 / 15 min per IP, [server/utils/rate-limit.ts](../server/utils/rate-limit.ts)) — verified 429 after 10 attempts
- Register wrapped in a single sqlite transaction — invite can't be consumed twice (verified 400 on reuse)
- Uploaded non-media (e.g. `text/html`) forced to download on both the presigned-redirect and
  `?proxy` paths (`Content-Disposition: attachment` + `nosniff`) — verified it does not render inline
- Chunked upload with no Content-Length rejected (411); Caddy `request_body max_size 30MB` + security headers
- S3 objects (incl. WebP previews) now deleted when a channel or member is deleted, not just their rows
- Channel-list query switched from a full-table `LEFT JOIN messages … GROUP BY` to a correlated
  index-seek subquery; new indexes on `attachments.message_id` and `messages.reply_to_id` (migration 0004→0005)
- `PRAGMA synchronous = NORMAL` under WAL; hourly stale-upload sweep (was boot-only);
  avatar/attachment redirects carry `Cache-Control: private, max-age=240`; WS ticket-map purge + 10 s auth timeout
- Message pagination cursor extended with an id tiebreaker (`before` + `beforeId`) so same-millisecond rows aren't skipped

**Message virtualization (v0.9.2)** — data-window cap on the chat message list, verified in a real
browser (Playwright, headless Chromium) against a 400-message-seeded channel:

- DOM held at ~150 message nodes while scrolling through 400+ messages in both directions
  (was unbounded); scroll position stayed anchored across every load/trim; no console errors
- Reached the true top (oldest message) and returned cleanly to the live tail, re-pinned to bottom
- Jump-to-message (search result → old message) loads an around-window, flashes the target, and
  scrolling back down reloads newer + returns to the live tail
- Server endpoint gained a symmetric `after`/`afterId` forward cursor and reports `hasMoreNewer`
  (used by the client to know when the window is detached from the live tail)

**Moderator role (v0.10.0)** — verified locally against the dev server:

- API smoke script (18 checks, all pass): member 403s on invites/channels; admin promotes → the
  moderator's **pre-promotion cookie** immediately works for invite create/list/revoke and channel
  create/rename; channel delete / password reset / role change stay 403 for moderators; the admin
  role is immutable (400); demotion cuts powers on the very next request (DB-checked guards,
  [ADR 0002](adr/0002-db-checked-role-guards.md))
- Migration applied to a copy of the dev DB: `is_admin` dropped, existing admin → `role='admin'`,
  everyone else `'member'`
- Two real browsers (Playwright): promoting maks flipped his UI **live without reload** — «+»
  channel buttons, rename-only dropdown (no «Удалить»), manage button appeared; his manage modal
  shows the members roster read-only (no reset/delete buttons); «модератор» badge rendered for both
  clients; demotion removed it all live

**Not yet verified (needs a human / real environment):**

- Real NAT traversal — test voice from two different networks (phone hotspot vs home Wi-Fi)
- Mobile browsers (esp. iOS Safari voice)
- Production Caddy: confirm the new `request_body`/`header` blocks parse on the live VPS

## Remaining work / next steps

1. **Test real NAT traversal** — voice from two different networks (phone hotspot vs home Wi-Fi).
2. **Test on mobile browsers**, especially iOS Safari voice.
