# 0007 — Message Source

Date: 2026-07-06
Status: accepted

## Context

ADR 0006 made a Telegram reply byte-identical to an in-app send — same DTO, same
audience, same mention encoding — deliberately, so the bridge was a transparent
pipe. We now want the _opposite_ for origin: the chat should visibly mark that a
Message arrived via the Telegram bridge ("через Telegram"), so other readers know
the author replied from Telegram rather than the app.

## Decision

Add a `source` enum column on `messages` with values `app` | `telegram`, non-null,
default `app` (existing rows backfill for free via the default). It is mirrored on
`MessageDto`, set once at creation in `createChannelMessage`, and **immutable** —
an in-app edit of a Telegram-origin message keeps `source='telegram'`. The HTTP
send route never sets it (defaults to `app`); the Telegram reply path in
`/api/telegram/ingest` passes `source:'telegram'`. The chat renders a small
"через Telegram" badge next to the author name when `source === 'telegram'`.

Chose an **enum over a boolean `via_telegram`**: one column, one DTO field, and
extensible to a future bridge (email, matrix, …) by adding an enum value instead
of a second boolean + migration. `source` lives on `messages`, not `members`, so
ADR 0006's privacy invariant (`telegram_chat_id` / link token never in `memberDto`
or the cookie) is untouched.

## Consequences

- Deliberately breaks ADR 0006's "identical DTO" invariant. That is the point:
  the indicator only exists because the two paths are no longer indistinguishable.
- The LiveKit `TrackSource` enum is a different context (voice tracks); no name
  collision in practice.
- Any future message-emitting path that bypasses `createChannelMessage` would
  silently get `source='app'` — the same risk ADR 0006 already flags for
  notification/audience, and for the same reason (the helper is the single choke
  point).
