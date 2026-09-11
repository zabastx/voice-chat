# Product decisions

The locked choices behind the build, what's deliberately deferred, and the chat/messaging milestone
plan. Part of [PROGRESS.md](../PROGRESS.md).

## Locked

| Decision       | Choice                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UI language    | **Russian** (`lang="ru"`, `ru` UApp locale)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Voice scale    | 2–5 concurrent participants                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Media          | Self-hosted **LiveKit** SFU — screen share needs an SFU ([ADR 0001](../adr/0001-self-hosted-livekit-sfu.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Structure      | One space, flat channel list; each channel `text` or `voice`; no guilds                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Roles          | **Admin** (first account) > **Moderator** > **Member** — single `role` enum, no permissions engine ([ADR 0002](../adr/0002-db-checked-role-guards.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Auth           | Single-use invite links → username + password; cookie sessions; no email/reset (admin resets). Sign-ins **persist** («запомнить меня», ticked by default) and roll forward on use, capped at the browsers' 400-day `Max-Age` clamp; revocation is a per-member **Sign-in Epoch**, not a sessions table — one integer, checked on a member row the middleware already read ([ADR 0012](../adr/0012-sign-in-epoch-revocable-sessions.md), v0.23.0). Per-device sign-out and a device list are deliberately **not** built: revocation is all-or-nothing per member                                                                                                                                                                                                                                                                                                                                  |
| Chat v1        | Persistent history, image/file attachments, edit & delete own (admin deletes any)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Attachments    | External **S3-compatible bucket** via aws4fetch; presigned GETs; nothing on VPS disk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Database       | **Postgres 18** (Drizzle + postgres.js); was SQLite in v1 — [ADR 0004](../adr/0004-postgres-replaces-sqlite.md) (v0.12.0)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Platform       | Responsive web + installable PWA                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Microphone     | Open mic by default; opt-in **noise gate** in an AudioWorklet, client-side and never relayed ([ADR 0010](../adr/0010-mic-noise-gate-audioworklet.md), v0.20.0). Push-to-talk stays unbuilt — browser key events need window focus, so it is useless in a fullscreen game without an OS-level hotkey                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Devices        | Microphone/camera/speaker choice is a **per-device preference, applied from one place** (`useVoice`'s watcher), with the voice control-bar picker and the settings panel as two surfaces onto it (v0.21.0). The picker's level meter borrows the noise gate's own reported level when a gate is attached and otherwise opens a short-lived test capture — a second capture of a live device is cheap and only happens while the popover is open, whereas always tapping the published track would put a worklet in everyone's audio path for a meter, which [ADR 0010](../adr/0010-mic-noise-gate-audioworklet.md) deliberately avoided. Output selection cannot reach a Watch Session's iframe ([gotcha 18l](../GOTCHAS.md)).                                                                                                                                                                   |
| Client memory  | The app is measured, not asserted: a change that claims to lower RAM lands with a `scripts/bench/` before/after ([BENCH.md](../BENCH.md)), which costs a `playwright-core` devDependency and a permanent harness. Three settled trade-offs behind v0.24.0: LiveKit runs with **adaptiveStream + dynacast on** — subscription quality follows what is actually on screen, so an off-screen tile can be briefly stale on return (accepted; the bench guards resumption with `call-video-return`); a voice message **plays through a media element, not WebAudio** — streaming instead of a retained `AudioBuffer`, which gives up sample-accurate scrubbing and makes duration a container question (hence the seek probe for MediaRecorder WebM); and per-message chrome (the hover toolbar) is **built on first hover**, trading a frame of latency on first hover for not building 150 of them. |
| Deploy         | docker compose to a rented VPS with a domain; ships its own Caddy for auto-HTTPS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Notifications  | In-app (unread badges, tab-title counter, sounds) + opt-in **Telegram bridge** for offline mentions/DMs with reply-to-send (v0.14.0, [ADR 0006](../adr/0006-telegram-notifications.md)); v0.15.0 forwards attachments + clickable links, badges Telegram replies «через Telegram» ([ADR 0007](../adr/0007-message-source.md))                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Watch Together | **Synced local embeds**, not relayed video — the SFU never carries the film ([ADR 0008](../adr/0008-watch-together-synced-embeds.md)); ephemeral room state, anyone in the roster controls, no host ([ADR 0009](../adr/0009-watch-session-in-memory-anyone-controls.md)). YouTube (video/Shorts/live) in v0.18.0; Twitch deferred                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

**Desktop Client, 2026-09-09:** proceed from the Tauri 2 prototype to a public Windows 10/11 x64
alpha. The Desktop Client continues to load the Web Release from one embedded production HTTPS
origin; a small versioned Native Bridge supplies only allowlisted native capabilities
([ADR 0013](../adr/0013-remote-ui-behind-versioned-native-bridge.md)). `0.1.0-alpha.1` proves the
installer, updater, tray, and single-instance delivery path. Global PTT remains a possible future
feature and is outside the current release plan.
The [prototype](../../desktop/README.md) measured 239.5 MiB for a two-person call in the
tray against the original 100–200 MB goal. Keep measuring the whole process tree and compare
like-for-like scenarios before claiming savings. Lower memory remains an optimization goal rather
than a release gate. Desktop Releases use the `Voice Chat` name, `ru.zabastx.voicechat` identifier,
independent `desktop-v<version>` tags, and one consent-based Desktop Update stream backed by signed
GitHub Release assets ([ADR 0014](../adr/0014-independent-desktop-releases-with-one-update-stream.md)).
Tags build drafts; publishing is the promotion step because the server endpoint selects the newest
published `desktop-v*` Release, while drafts remain invisible. The Web Release feature-detects each Native Bridge
capability; the initial bridge adds only immutable native state/events and the validated
`setVoiceActive(boolean)` signal needed to defer updates during a Voice Channel. Server failure
shows a bundled retry/exit screen; diagnostics remain in bounded local logs with no automatic
telemetry. Release assets include both the NSIS installer and a portable executable. Web and Desktop
Release versions/changelogs remain independent; bridge work updates whichever side changed.
The Portable EXE is a no-install binary that shares `%LOCALAPPDATA%` state with the installed client.
Uninstalling performs a full cleanup of that shared profile, settings, and local logs. Alpha keeps
the prototype's green headphones icon and uses Russian GitHub Release notes. The tag workflow runs
the repository and Rust quality gates before signing or bundling.
Portable updates open the replacement GitHub Release for manual download; installed and portable
launches share a single-instance boundary. DM and mention notifications must work while hidden,
using Web Notifications when verified and one bounded native bridge operation otherwise. The alpha
tray icon stays static. Updater signing secrets are released only by manual approval in the
`desktop-release` GitHub Environment and have an encrypted backup outside GitHub.

**Desktop Update feed, 2026-09-09** (issue #8, settled while building it): the feed answers `204`
for "nothing to offer" and `503` for "cannot tell" — a GitHub outage with a cold cache is not the
same statement as "you are current", and conflating them would hide an outage behind a silent
no-update. A Release is offerable only with all three x64 assets the release job produces together —
the NSIS setup, its `.sig` and the Portable EXE — because a Release missing one was not built whole
and should not be promoted; `latest.json` and the SHA-256 checksum are excluded because the feed
builds the manifest itself and reads neither. A failed refresh backs off for a full TTL rather than
retrying per request, so a GitHub rate limit is not prolonged by the feed's own traffic. Candidates
are ranked by semver rather than publish date, so re-drafting a bad Release falls back to the
previous version and re-publishing an old one cannot downgrade anybody. The minimum supported
Desktop Release travels in the `X-Desktop-Minimum-Version` header rather than in the manifest body:
it stays independent of the offer, is stated on the `204` where there is no body at all, and cannot
perturb Tauri's parsing of the manifest. The feed needs no Postgres — the only state is an in-memory
last-good answer, which a restart simply refetches. The fixture catalog stays a development
affordance: production ignores `NUXT_DESKTOP_RELEASE_FIXTURE`, because a fixture names its own URLs
and signatures and one env var should not be able to hand installed clients an unsigned update.

This ticket also added the repo's first test suite (`bun run test`, Bun's runner, no new
dependency), typechecked by its own `test/tsconfig.json` because `nuxt typecheck` only covers
`app/`, `server/` and `shared/`.

**Portable Desktop updates, 2026-09-11** (issue #9): the server manifest includes the exact public
GitHub Release page as `release_url`; Portable opens that page after explicit consent and never
downloads, installs, or replaces its running executable. The common coordinator owns scheduling,
SemVer comparison, and overlap suppression behind feed/prompt/action boundaries, while the build
stamps `portable` or `installed` into the binary. Filename and install-directory heuristics were
rejected because Portable can be renamed and both forms share one profile. The check starts only at
Tauri `Ready`, then repeats every six hours; feed and action failures produce fixed local diagnostics
and do not affect the remote Web Release. `VOICECHAT_DESKTOP_UPDATE_CHECK=1` is a compile-time-only
test affordance that permits loopback HTTP for the real-EXE fixture harness; normal release builds
still require a root HTTPS origin and HTTPS Release URL. The feed applies the same rule from its own
side: a Release whose page is not a credential-free HTTPS URL is skipped rather than offered, since
that URL is what a member's browser is sent to.

**Installed Desktop updates, 2026-09-11** (issue #10): the installed client shares the
coordinator with Portable and differs only in prompt and action. Signature verification is
`tauri-plugin-updater`'s, against a public key stamped in at build time rather than committed —
the private half belongs to the `desktop-release` environment (issue #12), so no key material
lives in this repository and every harness mints its own. An agreed install waits for the Voice
Channel to end, polling the Native Bridge flag every five seconds, and gives up after four hours
so the deferral can never outlive the six-hour cadence. The shell asks the plugin to install
rather than downloading anything itself, and the NSIS installer restarts the client, so the
action never returns on success. Loopback HTTP for the updater endpoint is a build-time test
affordance of the real-executable harnesses (`VOICECHAT_DESKTOP_UPDATE_CHECK=1`), which also
lets a harness build a second versioned artifact through a Tauri config override instead of
editing tracked files.

**Deferred to v2+:** browser/Web Push, multiple spaces, a real roles
engine, per-device Sign-in management (a `sessions` table with a device list and per-device
sign-out — the Sign-in Epoch can be replaced by one later without changing the cookie shape). Already un-deferred: Postgres (v0.12.0), 1:1 DMs
(v0.13.0, [ADR 0005](../adr/0005-direct-messages-as-channel-rows.md)), the mic noise gate
(v0.20.0, [ADR 0010](../adr/0010-mic-noise-gate-audioworklet.md)).

**On push-to-talk specifically:** the gate is not a half-step towards it and does not unblock it.
`keydown`/`keyup` only fire while the document has focus, so a member in a fullscreen game never
presses the key as far as the browser is concerned — and a hold interrupted by losing focus never
receives its `keyup`, leaving the mic open. In-browser PTT is therefore only worth building as a
convenience for members who are _not_ in a game; real PTT needs an OS-level hotkey, i.e. the
deferred desktop wrapper or a small companion helper. When it lands it should be a third
`micMode` driving the same worklet gain, not a second mechanism.

**Dropped, not deferred:** general link unfurling (the old M6). See below — don't re-propose it.

## v2 — Chat/messaging (M1–M5 shipped as v0.3.0–v0.7.0)

| Milestone                       | Notes                                                                  |
| ------------------------------- | ---------------------------------------------------------------------- |
| M1 — Markdown + autolinks       | `app/utils/markdown.ts` (markdown-it + DOMPurify); `.chat-prose`       |
| M1 — jump-to-message foundation | `aroundId=` window + client `jumpToMessage` + flash                    |
| M2 — @mentions                  | `shared/utils/mentions.ts`, composer autocomplete, chip + ping         |
| M3 — Replies                    | `replyToId` (no FK), reply banner, quote render, deleted-live          |
| M4 — Reactions                  | `reactions` table, toggle endpoint, emoji-picker-element, chips        |
| M5 — Message search (full-text) | `/api/search`, SearchModal + jump; FTS5 → Postgres tsvector in v0.12.0 |

M6 (general rich link previews) is **dropped** — it is no longer on the plan, deferred or otherwise.
It would have meant a server-side fetch of arbitrary user-posted URLs, i.e. an SSRF-hardened
fetcher, an image cache table and a privacy story about which host the server touches on whose
behalf — a large, permanently load-bearing surface for a five-person space. The two things it was
actually wanted for are already covered without any of that machinery: URLs are clickable via M1
autolink, and YouTube links get an inline player card in v0.19.0 (client-only, fixed host, no fetch
— see [features.md](features.md)). If a future case genuinely needs a preview, do what v0.19.0 did
and carve out that one host rather than reviving general unfurling.
