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

## v0.20.0 microphone noise gate

Driven headed as `danil` against the dev stack. The DSP was verified **deterministically** in an
`OfflineAudioContext` rather than through a fake microphone — it renders faster than real time and
lets the input amplitude be set exactly, so the assertions are on numbers rather than on "it
sounded right":

- **Gating**: a -80 dBFS "noise floor" renders to exactly `0.000000` RMS; a -17 dBFS "speech"
  burst renders to `0.141421` — precisely `0.2 / √2`, i.e. passed at unity gain, undistorted.
- **Hold**: 20 ms after the loud burst stops, output RMS is `0.000071` = `0.0001 / √2` — the gate
  is still open and still passing the now-quiet signal. 450 ms after (past the 300 ms hold) it is
  `0.000000`. That is the hangover working, measured rather than inferred.
- **Attack**: reaches 99 % of input 7.9 ms after the threshold is crossed — no clipped consonant.
- **No click**: driven with a constant-amplitude source so the output _is_ the gain envelope, the
  largest sample-to-sample step is `4.17e-4`, exactly the theoretical per-sample ramp increment.
  The envelope is continuous.
- **Bypass paths**: `enabled: false` and `thresholdRms: 0` both pass a -80 dBFS signal through at
  exactly `1.00e-4` (unity), confirming an un-opted-in member's audio is untouched.

Then end-to-end in the running app, with `getUserMedia` overridden to hand LiveKit a real
`MediaStreamTrack` synthesised from Web Audio (so the publish/attach path is genuinely exercised):

- Joining `lounge` with `micMode: 'gate'` calls `addModule('/mic-gate-worklet.js')` exactly once and
  constructs one `AudioWorkletNode`, with **zero console errors** and no unhandled rejections.
- The settings meter reads **77** for a tone whose theoretical level is 75.7 — the whole chain
  (worklet RMS → `postMessage` → `rmsToLevel` → UI) is calibrated, not just plausible.
- Threshold marker renders at `45%`, readout says «микрофон открыт».
- Dragging the threshold to 100 flips the readout to «микрофон закрыт» **without a reconnect** — the
  live `port.postMessage` update path works. The meter keeps reading 77 while shut, which is correct:
  it shows the input level so you can still see where your voice sits relative to the marker.
- Mode + both sliders persist to `voice-chat:prefs`; switching to «Шумовой порог» reveals both
  sliders at their defaults (45 / 300 мс).

One UI gap was found and fixed during the run: switching to gate mode while _not_ in a call left
the meter and its "join a channel to tune this" hint hidden, which is exactly when that hint is
needed — the bar and marker now render whenever the mode is on.

**Adversarial review afterwards found 14 issues, all fixed in the same change** — the headed run
above passes on the happy path, which is exactly why it missed them. The four that mattered:
`toggleMute` republishing an unprocessed track after a mic-less join (wide-open mic while the UI
says «Шумовой порог»); an unguarded `stopProcessor` able to leave the RTP sender on a stopped
track (inaudible to everyone, invisible to its owner); the out-of-call meter's 8-bit
quantization floor landing at ~level 25, under the default threshold of 45, on the very meter
used to place it; and a memoised `addModule` **rejection** disabling the gate until the member
rejoined. Also fixed: stale-gate handle clobbering, a leaked mic-test stream, orphaned
`MediaStreamTrack`s and worklet processors on every `restart`, a stereo up-mix that would have
disabled DTX/RED on reconnect, an ungated window while the module fetched at join, a dead meter
after a failed attach, NaN output on zero-length input blocks, a stale first peak on reopening
the panel, and a duplicated prefs watcher under HMR.

The four that could make someone unheard or unfiltered **were then driven headed** on a clean
server, and the DSP re-rendered identically afterwards (same four RMS figures, no `NaN`):

- **Mic denied at join, then granted and unmuted** — the exact republish path. Before: zero
  `addModule` calls, zero nodes, wide-open mic. After: the module loads and a node is
  constructed on the unmute, and the settings meter comes up live at 76 with the gate open.
- **Simulated 502 on the worklet module** — the attach fails, and the mic-test button is
  **visible again** (it used to be hidden whenever the mode said «Шумовой порог», leaving no
  way to check the microphone at all in the one state where it was broken).
- **Retry after that failure** — a second `addModule` call actually goes out (2 attempts, not
  1. and the gate attaches, proving the rejected module promise is no longer memoised onto the
     Room's `AudioContext` for the rest of the call.
- **`{stop: true}` on a retired node** — level posts drop from 5 per 300 ms to 0, so the audio
  thread really does release the processor instead of stranding one per `restart`.
- **Mono destination** — `getSettings().channelCount` is 1 against the default 2, so the
  stereo up-mix that would have disabled DTX/RED on reconnect is gone.
- **Joining with `micMode: 'open'`** makes **zero** `addModule` calls, confirming the
  un-opted-in path is untouched.

Still reasoned from livekit-client's source rather than driven: the guarded `stopProcessor`
failure path (needs a device that dies mid-detach) and the stale-attach handle guard.

Adding `prefetchMicGateWorklet` to an existing `app/utils/` file mid-run triggered
[gotcha #3](../GOTCHAS.md) again (`useToast is not defined` on an unrelated route), so the fixes
above were driven on a second dev server rather than on the poisoned one.

**Gotcha for future runs:** an `audioWorklet.addModule()` fetch shows up in neither
`performance.getEntriesByType('resource')` nor Playwright's network log, even when it definitely
ran. Checking either one reads as "the gate never attached". Patch `AudioWorklet.prototype.addModule`
in-page to observe it.

## v0.21.0 device picker on the voice screen

Driven headed against the local stack (Postgres/LiveKit/MinIO from `compose.dev.yaml`, dev server on
:3001). Three Chromium sessions, because the interesting states differ only by what the browser will
hand over: **real hardware** (permissions granted, actual mics), **fake device**
(`--use-fake-device-for-media-stream`, so the meter has a signal to show), and **denied** (Playwright's
default — no grant at all).

- **Picker renders and is reachable before joining** — «Устройства» sits next to «Подключиться» while
  disconnected, and between the camera and share buttons while connected (icon order confirmed as
  `mic, video, settings-2, monitor-up, tv, phone-off`). Popover shows Микрофон / Динамики / Камера +
  «Все настройки звука».
- **The meter is live, not decorative** — with the fake device the bar moved across 7–8 distinct values
  peaking at 84–91 over 3 s; with real hardware in a silent room it sat at 0, which is the honest
  answer. Closing the popover removes it; reopening brings it back moving, so the capture start/stop
  cycle is clean.
- **Settings deep link lands on «Голос и видео»** — the opened modal's fields are Микрофон / Режим
  микрофона / Динамики / Камера, not the profile panel.
- **Device switch mid-call** — picked «Fake Audio Input 2» while connected: preference persisted, the
  select kept the new value, no error toast, no revert (i.e. `switchActiveDevice` resolved).
- **Camera switch mid-call** — the standing bug: picked the camera while it was live, preference stored,
  camera stayed on, no toast. Before this change the same write reached nothing until a rejoin.
- **No-permission path** — with the microphone denied, the popover shows the hint + «Разрешить доступ»
  and **no** meter, so opening it never fires a prompt. Clicking grant against a hard denial surfaces
  «Нет доступа к устройствам» rather than hanging.
- **Stale id pruning** — planted `micDeviceId: 'bogus-device-id-that-cannot-resolve'`, reloaded: cleared
  to `null`, select back to «По умолчанию», **no toast** (silent at startup, as designed).
- **Settings panel after the refactor** — «Проверить микрофон» still starts a meter (7 distinct values,
  max 72) and still offers «Остановить проверку», so moving it onto `useMicLevel` cost it nothing.

Two bugs were found _by_ this run and fixed in the same change: the popover checked `needsPermission`
before the un-awaited first enumeration resolved (so the meter never started on first open), and
`needsPermission` tested «has an id but no label» — which never matches, because a pre-grant placeholder
has an **empty `deviceId`** as well as an empty label, so the grant button could not appear in the one
state it exists for.

**Gotcha for future runs:** editing a _newly added_ composable mid-session made the dev server SSR-fail
with `usePreferences is not defined` (an auto-import artifact, not a code defect) — it renders clean
after a dev-server restart. Don't chase it as a bug.

### Second pass, after a two-axis code review

The review found three behavioural defects; all were fixed and the fixes driven:

- **Spurious «Микрофон отключён» after granting permission.** The "have we looked before?" flag
  flipped on the first _enumeration_, but pruning is skipped for any list that cannot be trusted (no
  labels = no grant). So the first **trustworthy** look — the one right after the member clicks
  «Разрешить доступ» — counted as "later" and toasted about a device that was already gone before
  the app started. Now tracked per list, on the first trustworthy enumeration. Driven both ways:
  planted a stale id with the microphone denied → granted mid-session → id cleared, select back to
  «По умолчанию», **no toast**. Then planted a _real_ device id and simulated an unplug (patched
  `enumerateDevices` to omit it + dispatched `devicechange`) → cleared **with** the toast. Both
  branches of the Q12/Q17 split now demonstrably work.
- **A dead stop button.** The settings panel's «Остановить проверку» keyed off the _global_ "a stream is
  open" flag rather than "this panel opened it", so with the picker holding the capture the panel
  would offer a stop button whose click did nothing. The meter composable now exposes a per-consumer
  `ownsTest`. Round-trip re-driven: start → meter + «Остановить», stop → meter gone.
- Plus the cleanups: the `'default'`↔`null` translation and the sentinel now live once in
  `useMediaDevices.deviceModel` (they were copy-pasted into both surfaces — the exact drift the
  shared composables exist to prevent, and the subject of gotcha 6); the three device watchers in
  `useVoice` collapsed into one loop over `DEVICE_PREFS`; `revertingDevice` moved to module scope;
  `live` renamed `liveLevelAvailable`; boolean-flag call sites replaced with
  `startListening`/`stopListening`, `startMonitoring`/`stopMonitoring` and
  `refresh({ requestPermissions })`; the unused `size` prop dropped.

Re-driven after those changes: popover renders all three rows, meter still moves on the fake device
(7 distinct values, max 72), mid-call **microphone** switch and mid-call **camera** switch both still
persist with no toast and no revert — i.e. the collapsed loop watcher behaves as the three separate
ones did.

**Still not verified here:** switching between two _real_ microphones/cameras and hearing the change,
a real hardware unplug (both prune branches were driven, but the disappearance was simulated with a
patched `enumerateDevices`), `setSinkId` output switching actually moving the audio, and Firefox
(where the Динамики row is expected to be disabled). These need real hardware — see the standing
list below.

## Not yet verified (needs a human / real environment)

- **Device picker with real hardware (v0.21.0)** — switch between two physical microphones and two cameras mid-call and confirm the other member hears/sees the change; unplug a device mid-call and check the «Микрофон отключён» toast fires against real hardware (both prune branches were driven, but the disappearance was simulated with a patched `enumerateDevices`); confirm Динамики actually moves playback to the chosen output, and that the row is disabled in Firefox
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
- **Noise gate (v0.20.0)** — mostly ✅ verified, see the section above. Still not driven, and each
  needs a human at a real microphone: **real speech** against real room noise (does 45/300 ms
  actually feel right, does it chop word endings, does AGC drift the floor into the threshold over
  a long call); a **mid-call microphone switch**, which relies on LiveKit calling the processor's
  `restart` and reusing the cached `AudioContext` — confirmed by reading livekit-client's
  `restartTrack`, never driven; the **hidden-tab** case, which is the entire reason the gate is an
  AudioWorklet and cannot be shown to work by a foreground browser test; and **Safari/iOS**, where
  `createMediaStreamSource` has history and the `AudioContext` needs a user gesture
- Real NAT traversal — voice from two different networks (phone hotspot vs home Wi-Fi)
- Mobile browsers (esp. iOS Safari voice) — for Watch Together specifically, that `playsinline`
  actually keeps the video in the filmstrip layout instead of forcing fullscreen
- Production Caddy: `request_body`/`header`/crawler-403 blocks parse on the live VPS. The config now
  validates and serves correctly in a local `caddy:2` container (same image as prod), so what's left
  is confirming it on the real host after a `docker compose up -d caddy`
- Production Postgres cutover on the VPS (DEPLOY.md "Migrating an existing SQLite deployment")
