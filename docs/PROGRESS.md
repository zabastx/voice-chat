# Progress & Plan

Status of the personal Discord clone (Nuxt 4 + @nuxt/ui). Plan approved via grilling session,
built end-to-end, live on the VPS.

This file is the index and the to-do list; the detail lives in `docs/progress/`. **Keep all of it
in sync with reality as part of the same change** — a stale progress doc is a bug.

## Contents

| File                                                 | What's in it                                                                                                                                                                                                                                             |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [progress/decisions.md](progress/decisions.md)       | The locked product decisions (UI language, media, roles, storage, DB, deploy…), what's deferred to v2+, and the M1–M6 chat/messaging milestones. Read before proposing an approach — most "why is it like this" answers are here or in the ADR it links. |
| [progress/features.md](progress/features.md)         | One row per feature area: built / done / deployed, plus the implementation notes and the per-version deltas. **The first thing to check before starting work** — it says what exists and what still says «needs verify».                                 |
| [progress/verification.md](progress/verification.md) | What was actually driven and what it proved, per release, plus the standing list of things **not** yet verified (DMs end-to-end, Telegram end-to-end, NAT, mobile, prod Caddy/Postgres). Add a section here when you verify something.                   |

Related, outside this folder: [GOTCHAS.md](GOTCHAS.md) (traps that already cost time),
[DEPLOY.md](DEPLOY.md) (VPS runbook), [adr/](adr/) (decision records),
[CONTEXT.md](../CONTEXT.md) (glossary).

## Remaining work / next steps

1. **Postgres cutover on the VPS** — follow DEPLOY.md; back up the SQLite file first; afterwards
   remove the legacy `app-data` volume in a follow-up change.
2. **Test real NAT traversal** — voice from two different networks.
3. **Test on mobile browsers**, especially iOS Safari voice.
4. **Finish Watch Together verification** — a live broadcast, a Shorts URL, a genuinely
   embedding-disabled video, and a real buffering stall are still undriven (see the v0.18.0 section
   in [progress/verification.md](progress/verification.md)). Optionally close the two known gaps: no
   «Смотреть вместе» in the sidebar `VoicePanel`, and no direct replace without stopping first.
5. **Twitch for Watch Together**, if wanted — the sync layer is source-agnostic and `WatchDto`
   already carries `source`, so this is a URL-parser case plus a second embed wrapper. Twitch
   embeds need `parent=<window.location.hostname>` and break on any unexpected host; live needs
   no timeline sync, but Twitch VODs would need their own seek handling.
