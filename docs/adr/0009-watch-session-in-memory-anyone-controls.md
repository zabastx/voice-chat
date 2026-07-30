# 0009 — A Watch Session is ephemeral room state, and anyone in the room drives it

Date: 2026-07-30
Status: accepted

## Context

Given [ADR 0008](0008-watch-together-synced-embeds.md) — the server holds shared playback intent
rather than media — two questions remain, and both invite a future reader to "fix" the obvious
thing: why isn't this in Postgres like every other piece of state, and why is there no host?

## Decision

**A Watch Session is ephemeral room state, stored in memory beside the Voice State.** It is a
`Map` keyed by Channel id in the same shape as [voice-state.ts](../../server/utils/voice-state.ts),
delivered through the WS `snapshot` every client already receives on connect — which is what makes
the late-joiner case fall out for free.

Persisting it to Postgres was rejected as _incoherent rather than merely unnecessary_: the Voice
State it sits next to is itself rebuilt from LiveKit webhooks and evaporates on restart. A
durable Watch Session would resume after a deploy with a film playing to an empty room. Session
state should share the lifetime of the session.

Two rules keep that ephemerality from being annoying:

- **An empty room pauses the Watch Session; it does not end it.** The roster hitting zero freezes
  the anchor and leaves the entry in place, so a 20-second network blip or a 10-minute break does
  not cost you the URL and your position. Pausing is also required for correctness — an
  unpaused anchor with nobody present would silently run the film to the end. Memory is bounded
  by Voice Channel count, so at most a handful of entries.

  The trigger is `voiceParticipantLeft` observing the roster hit zero, **not** LiveKit's
  `room_finished`. The latter fires only after `empty_timeout` (300s by default), which would let
  the anchor run five minutes past the moment everyone actually stopped watching — precisely the
  "resumes somewhere we never got to" failure this rule exists to prevent. `room_finished` still
  calls the same function as a backstop; it is idempotent on an already-paused session.

- **Audience is the Voice Channel roster**, not a separate membership. No new entity, no
  "who is watching" to track. Joining without a microphone already works, so silent viewers are
  not excluded.

**Anyone in the roster may play, pause, seek, replace or stop.** No host, no ownership, no
transfer, no `requireRole` check. Conflicts resolve last-write-wins on the server, and each
change is attributed in a toast («Перемотка · Данил») so a seek war is at least legible. The
toasts are noun phrases rather than verbs on purpose: Russian past-tense verbs agree with the
actor's gender, and «перемотал» would be wrong for half the possible members.

This is a deliberate no. A host model is the more "correct" design and was rejected on cost: it
introduces ownership, a hand-off UI, and a reassignment rule for when the host disconnects
mid-film — machinery a five-person friend group will never need, in an app that has deliberately
avoided a permissions engine ([ADR 0002](0002-db-checked-role-guards.md) keeps roles to three
hierarchical tiers). Trust does the work instead.

Authorization resolves the target room from the caller's presence in the roster and rejects the
request unless it matches the `:id` they sent, so a client cannot act on a room it is not in. Be
precise about what that is and isn't: it is an equality check against an in-memory roster, not
the stronger authorization-by-construction that `voiceSetMutedByMember` gets by accepting no
channel id at all. The roster is webhook-populated, so it is also _lossy_ — a member who has just
clicked join, or whose `participant_joined` webhook was dropped ([gotcha #14](../GOTCHAS.md)),
is not in it yet and will be told «Сначала подключитесь к голосовому каналу» while their UI
plainly shows them connected. That message is misleading in exactly the case where it fires most.

## Consequences

- Commands arrive over HTTP (`POST /api/channels/:id/watch`, `DELETE` the same, `.../watch/state`)
  and results leave over WS. Command frequency is a handful per film, so the extra round trip is
  nothing against a 2s drift threshold — and it keeps zod validation and URL parsing on the path
  where every other mutation in the app already lives, rather than hand-rolled in the socket
  handler.
- A fourth endpoint, `.../watch/meta`, carries what only a loaded player knows: the title, and
  whether the source is live. It is deliberately **not** a control action — it takes no position,
  never re-anchors, and records no actor, so a metadata report can never be mistaken for a seek
  or steal attribution in the toast. It is also ref-scoped: a late report for a video that has
  since been replaced is dropped rather than applied to its successor.
- Watch state ships as a **parallel map** in the snapshot, not folded into `VoiceRooms`.
  `VoiceRooms` is `Record<channelId, VoiceParticipant[]>` — an array of members with no
  room-level object — and a Watch Session is a property of the room, not of any member.
  Restructuring it would touch every consumer; a parallel map is additive and breaks nothing.
- Because that map reaches every connected client, not just the room's occupants, a Watch Session
  is visible in the sidebar to people who have not joined. That is intended: the roster is
  already public so members can see where the party is, and a film is a stronger invite than a
  roster.
- A server restart drops the session. Accepted, and consistent with the roster vanishing too.
- "Stuck paused" has two possible causes — a real pause, or a missed `room_finished` webhook.
  Benign, but worth knowing before debugging one.
