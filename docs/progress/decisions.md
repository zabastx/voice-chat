# Product decisions

The locked choices behind the build, what's deliberately deferred, and the chat/messaging milestone
plan. Part of [PROGRESS.md](../PROGRESS.md).

## Locked

| Decision       | Choice                                                                                                                                                                                                                                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI language    | **Russian** (`lang="ru"`, `ru` UApp locale)                                                                                                                                                                                                                                                                                       |
| Voice scale    | 2–5 concurrent participants                                                                                                                                                                                                                                                                                                       |
| Media          | Self-hosted **LiveKit** SFU — screen share needs an SFU ([ADR 0001](../adr/0001-self-hosted-livekit-sfu.md))                                                                                                                                                                                                                      |
| Structure      | One space, flat channel list; each channel `text` or `voice`; no guilds                                                                                                                                                                                                                                                           |
| Roles          | **Admin** (first account) > **Moderator** > **Member** — single `role` enum, no permissions engine ([ADR 0002](../adr/0002-db-checked-role-guards.md))                                                                                                                                                                            |
| Auth           | Single-use invite links → username + password; cookie sessions; no email/reset (admin resets)                                                                                                                                                                                                                                     |
| Chat v1        | Persistent history, image/file attachments, edit & delete own (admin deletes any)                                                                                                                                                                                                                                                 |
| Attachments    | External **S3-compatible bucket** via aws4fetch; presigned GETs; nothing on VPS disk                                                                                                                                                                                                                                              |
| Database       | **Postgres 18** (Drizzle + postgres.js); was SQLite in v1 — [ADR 0004](../adr/0004-postgres-replaces-sqlite.md) (v0.12.0)                                                                                                                                                                                                         |
| Platform       | Responsive web + installable PWA; voice-activity detection (no push-to-talk)                                                                                                                                                                                                                                                      |
| Deploy         | docker compose to a rented VPS with a domain; ships its own Caddy for auto-HTTPS                                                                                                                                                                                                                                                  |
| Notifications  | In-app (unread badges, tab-title counter, sounds) + opt-in **Telegram bridge** for offline mentions/DMs with reply-to-send (v0.14.0, [ADR 0006](../adr/0006-telegram-notifications.md)); v0.15.0 forwards attachments + clickable links, badges Telegram replies «через Telegram» ([ADR 0007](../adr/0007-message-source.md))     |
| Watch Together | **Synced local embeds**, not relayed video — the SFU never carries the film ([ADR 0008](../adr/0008-watch-together-synced-embeds.md)); ephemeral room state, anyone in the roster controls, no host ([ADR 0009](../adr/0009-watch-session-in-memory-anyone-controls.md)). YouTube (video/Shorts/live) in v0.18.0; Twitch deferred |

**Deferred to v2+:** browser/Web Push, desktop wrapper / global PTT, multiple spaces, a real roles
engine, rich link previews (M6 — SSRF/privacy). Already un-deferred: Postgres (v0.12.0), 1:1 DMs
(v0.13.0, [ADR 0005](../adr/0005-direct-messages-as-channel-rows.md)).

## v2 — Chat/messaging (M1–M5 shipped as v0.3.0–v0.7.0)

| Milestone                       | Notes                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| M1 — Markdown + autolinks       | `app/utils/markdown.ts` (markdown-it + DOMPurify); `.chat-prose`       |
| M1 — jump-to-message foundation | `aroundId=` window + client `jumpToMessage` + flash                    |
| M2 — @mentions                  | `shared/utils/mentions.ts`, composer autocomplete, chip + ping         |
| M3 — Replies                    | `replyToId` (no FK), reply banner, quote render, deleted-live          |
| M4 — Reactions                  | `reactions` table, toggle endpoint, emoji-picker-element, chips        |
| M5 — Message search (full-text) | `/api/search`, SearchModal + jump; FTS5 → Postgres tsvector in v0.12.0 |

M6 (rich link previews) stays deferred; URLs are clickable via M1 autolink. v0.19.0 carves out the
one case that needs none of M6's machinery — YouTube links get an inline player card (see
[features.md](features.md)). General unfurling still waits on the SSRF/privacy work.
