# Progress & Plan

Status of the personal Discord clone (Nuxt 4 + @nuxt/ui). Plan approved via grilling session,
built end-to-end, live on the VPS.

This file is the index and the to-do list; the detail lives in `docs/progress/`. **Keep all of it
in sync with reality as part of the same change** — a stale progress doc is a bug.

## Contents

| File                                                 | What's in it                                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [progress/decisions.md](progress/decisions.md)       | The locked product decisions (UI language, media, roles, storage, DB, deploy…), what's deferred to v2+, what's dropped, and the M1–M5 chat/messaging milestones. Read before proposing an approach — most "why is it like this" answers are here or in the ADR it links. |
| [progress/features.md](progress/features.md)         | One row per feature area: built / done / deployed, plus the implementation notes and the per-version deltas. **The first thing to check before starting work** — it says what exists and what still says «needs verify».                                                 |
| [progress/verification.md](progress/verification.md) | What was actually driven and what it proved, per release, plus the standing list of things **not** yet verified (DMs end-to-end, Telegram end-to-end, NAT, mobile, prod Caddy/Postgres). Add a section here when you verify something.                                   |

Related, outside this folder: [GOTCHAS.md](GOTCHAS.md) (traps that already cost time),
[DEPLOY.md](DEPLOY.md) (VPS runbook), [BENCH.md](BENCH.md) (client memory benchmark),
[adr/](adr/) (decision records), [CONTEXT.md](../CONTEXT.md) (glossary).

## Remaining work / next steps

1. **Drop the legacy `app-data` volume** — the Postgres cutover on the VPS is **done** (prod has
   been on Postgres since before v0.21.0), but the volume that carried `/data/app.sqlite` is still
   mounted in [compose.yaml](../compose.yaml) and the one-shot `scripts/migrate-sqlite-to-pg.ts` is
   still copied into the image by the [Dockerfile](../Dockerfile). Both can go once you have
   confirmed nothing on the VPS still reads them; DEPLOY.md's cutover section becomes history at
   the same time.
2. **Tune the noise gate at a real microphone** (v0.20.0) — the DSP is verified numerically and the
   gating is now verified end-to-end at a second browser (silence vs. bursts, mid-call device switch,
   hidden tab, and the mic-less-join re-attach; see [progress/verification.md](progress/verification.md)),
   but nobody has yet **spoken** into it. Confirm the 45 / 300 ms defaults against real room noise,
   check it doesn't chop word endings, and check AGC doesn't drift the floor into the threshold over
   a long call. iOS Safari is still undriven.
3. **Check the new device picker against real hardware** (v0.21.0) — the popover, the meter, the permission paths and the stale-id prune were all driven in Playwright, but swapping between two physical microphones/cameras, the unplug toast, and `setSinkId` output switching need a human with the devices in hand (see [progress/verification.md](progress/verification.md)).
4. **Test real NAT traversal** — voice from two different networks.
5. **Test on mobile browsers**, especially iOS Safari voice.
6. **Finish Watch Together verification** — a live broadcast, a Shorts URL, a genuinely
   embedding-disabled video, and a real buffering stall are still undriven (see the v0.18.0 section
   in [progress/verification.md](progress/verification.md)). Optionally close the two known gaps: no
   «Смотреть вместе» in the sidebar `VoicePanel`, and no direct replace without stopping first.
7. **Optional VK polish** (v0.22.0) — everything in
   [ADR 0011](adr/0011-vk-as-second-notification-transport.md) is now driven, attachments included
   (see [progress/verification.md](progress/verification.md)). Two loose ends, neither blocking:
   a notification body still renders `@username` as a link to whichever VK account owns that screen
   name (GOTCHAS 23), and voice notes arrive as documents — inline VK voice messages need ffmpeg in
   the runtime image to transcode to OGG/OPUS 16 kHz.
8. **Remaining client-memory items** (v0.24.0 took the three big ones — see
   [progress/verification.md](progress/verification.md) for the measured deltas). Left on the table,
   each worth a `scripts/bench` run to justify: a YouTube embed stays a live iframe once played until
   its row is trimmed from the window, so an IntersectionObserver resetting `playing` would reclaim
   tens of MB per played embed; `RENDER_CAP` could drop from 150 to ~80 (scroll-up reload already
   exists, so it is invisible) and would halve DOM and decoded bitmaps again; and the adaptive-stream
   win is so far only measured against a fake camera — a real 1080p screen share is the case worth
   measuring, which needs a bench scenario that can drive `getDisplayMedia`.
9. **Twitch for Watch Together**, if wanted — the sync layer is source-agnostic and `WatchDto`
   already carries `source`, so this is a URL-parser case plus a second embed wrapper. Twitch
   embeds need `parent=<window.location.hostname>` and break on any unexpected host; live needs
   no timeline sync, but Twitch VODs would need their own seek handling.
10. **Build the Tauri 2 Windows alpha** ([spec #4](https://github.com/zabastx/voice-chat/issues/4),
    decision recorded 2026-09-09) from the prototype on
    `prototype/tauri-windows`; [run instructions](../desktop/README.md). The accepted
    shape is Windows 10/11 x64 with the server-hosted Web Release behind a versioned Native Bridge
    ([ADR 0013](adr/0013-remote-ui-behind-versioned-native-bridge.md)) and one GitHub-backed update
    stream ([ADR 0014](adr/0014-independent-desktop-releases-with-one-update-stream.md)). First deliver
    `0.1.0-alpha.1` with an installer, updater, tray, and single-instance behavior; global PTT is
    left for a future plan. Release assets include NSIS and a no-install Portable EXE; both share a
    single profile and instance, while only the installed client applies updates automatically.
    Login, bidirectional synthetic audio, tray hide/restore, and continued audio
    while hidden are verified. A two-person audio call in the tray measured **239.5 MiB private
    commit**, above the original 100–200 MB optimization goal, which is not a release gate. Real
    devices, screen sharing, embedded players, long calls, and update delivery remain unverified or
    unbuilt. The per-user NSIS and Portable EXE are built and passed the local install/profile/
    single-instance/uninstall harness. Spec #4 is split into native GitHub sub-issues
    [#5–#14](https://github.com/zabastx/voice-chat/issues/4).
    [#5 production shell](https://github.com/zabastx/voice-chat/issues/5) is built and verified
    locally, and [#8 Update feed](https://github.com/zabastx/voice-chat/issues/8) is built: the public
    `GET /api/desktop/update` selects the newest published `desktop-v*` Release and answers the Tauri
    updater, covered by the repo's first test suite (`bun run test`). It has not run against the VPS
    and no `desktop-v*` Release has been published yet, so the feed has never served a real one. The
    [#6 Native Bridge](https://github.com/zabastx/voice-chat/issues/6) is built: the shell freezes a
    versioned descriptor onto the trusted origin only, the remote page still gets no Tauri `invoke`,
    and its one reverse operation — `setVoiceActive(boolean)` — is what the updater ticket will read
    to wait out a call. One set of contract scenarios runs against the browser adapter in
    `bun test` and against the real Tauri adapter in `bun run desktop:check`.
    [#7 installer and Portable EXE](https://github.com/zabastx/voice-chat/issues/7) is built:
    release builds emit Russian x64 NSIS and Portable artifacts, both share the identifier-scoped
    profile and instance, and uninstall clears app data without removing the system WebView2
    Runtime. The current implementation frontier is
    [#9 Portable updates](https://github.com/zabastx/voice-chat/issues/9), followed by the installed
    updater path.
