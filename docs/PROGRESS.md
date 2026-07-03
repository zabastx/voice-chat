# Progress & Plan

Status of the personal Discord clone. Started from a bare Nuxt 4 + @nuxt/ui scaffold; the plan
below was approved via a grilling session and is now built end-to-end and verified locally
(not yet deployed to the VPS).

## Product decisions (locked)

| Decision      | Choice                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------- |
| UI language   | **Russian** (locked after initial build; `lang="ru"`, `ru` UApp locale)                                       |
| Voice scale   | 2–5 concurrent participants                                                                                   |
| Media         | Self-hosted **LiveKit** SFU (screen share needs an SFU — see [ADR 0001](adr/0001-self-hosted-livekit-sfu.md)) |
| Structure     | One space, flat channel list; each channel is `text` or `voice`; no guilds                                    |
| Roles         | Two: **Admin** (first account) + **Member** — one boolean, no permissions engine                              |
| Auth          | Single-use invite links → username + password; cookie sessions; no email/reset (admin resets)                 |
| Chat v1       | Persistent history, image/file attachments, edit & delete own (admin deletes any)                             |
| Attachments   | External **S3-compatible bucket** via aws4fetch; presigned GETs; nothing on VPS disk                          |
| Database      | SQLite (Drizzle); one file on a volume                                                                        |
| Platform      | Responsive web + installable PWA; voice-activity detection (no push-to-talk)                                  |
| Deploy        | docker compose to a rented VPS with a domain; ships its own Caddy for auto-HTTPS                              |
| Notifications | In-app only: unread badges, tab-title counter, join/leave/message sounds                                      |

**Deferred to v2+:** replies, reactions, markdown rendering, link previews, @mentions,
browser/Web Push, desktop wrapper / global PTT, DMs, message search, multiple spaces, a real
roles engine, Postgres.

## Feature status

| Area                                                              | Status                             | Notes                                                         |
| ----------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- |
| Auth, invites, first-user-admin                                   | ✅ done                            | `server/api/auth/*`, `server/api/invites/*`                   |
| Channels CRUD (admin)                                             | ✅ done                            | live-synced over WS                                           |
| Text chat: send / edit / delete, unread, day separators, grouping | ✅ done                            | `app/pages/channels/[id].vue`                                 |
| Realtime hub (presence, messages, channels, voice state)          | ✅ done                            | `server/utils/ws-hub.ts`, `server/routes/_ws.ts`              |
| Attachments (S3 upload, presigned serve, auth-gate, cleanup)      | ✅ done                            | `server/utils/storage.ts`, `server/api/attachments/*`         |
| Voice channels (join/leave, mute, speaking, roster)               | ✅ done                            | `useVoice.ts` + LiveKit webhooks                              |
| Screen share (publish + fullscreen viewer)                        | ✅ built, ⚠️ video path unverified | headless can't capture a screen                               |
| Sounds, tab-title counter                                         | ✅ done                            | `app/utils/sounds.ts`, `useHead` in layout                    |
| PWA (manifest + icons)                                            | ✅ done                            | `public/manifest.webmanifest`, `public/icon-*.png`            |
| Russian localization (UI + server errors)                         | ✅ done                            | server errors in `message` field                              |
| Deploy stack (Dockerfile, compose, Caddy, livekit.yaml)           | ✅ written, ⚠️ not run on VPS      | see [DEPLOY.md](DEPLOY.md)                                    |
| User settings (profile, voice/video devices, notifications)       | ✅ done                            | `SettingsModal.vue`, `server/api/me/*`, prefs in localStorage |

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
- Settings modal end-to-end: display name saves + propagates live to old messages/SelfPanel,
  avatar upload→MinIO→presigned serve (5 render sites), wrong-current-password 400, mic-test level
  meter, prefs persisted to localStorage, Esc close

**Not yet verified (needs a human / real environment):**

- Screen-share _video_ rendering (headless browsers can't capture a screen; the publish/subscribe
  path is identical to the verified audio path, but give it a real two-browser test)
- Real NAT traversal — test voice from two different networks (phone hotspot vs home Wi-Fi)
- The actual VPS `docker compose up` — nothing has run on the server yet
- Mobile browsers (esp. iOS Safari voice)

## Remaining work / next steps

1. **Deploy to the VPS.** Follow [DEPLOY.md](DEPLOY.md). Needs two DNS records (`DOMAIN` and
   `livekit.DOMAIN`) and the firewall ports opened (80/443 tcp, 7881 tcp, 50000–60000 udp).
2. **Manually verify screen share** with two real browsers once deployed (or locally in headed mode).
3. **git**: nothing is committed yet — the tree is still the initial scaffold commit plus all this
   work uncommitted. Make the first real commit when ready.
