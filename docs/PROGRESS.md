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
[DEPLOY.md](DEPLOY.md) (VPS runbook), [adr/](adr/) (decision records),
[CONTEXT.md](../CONTEXT.md) (glossary).

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
8. **Twitch for Watch Together**, if wanted — the sync layer is source-agnostic and `WatchDto`
   already carries `source`, so this is a URL-parser case plus a second embed wrapper. Twitch
   embeds need `parent=<window.location.hostname>` and break on any unexpected host; live needs
   no timeline sync, but Twitch VODs would need their own seek handling.
