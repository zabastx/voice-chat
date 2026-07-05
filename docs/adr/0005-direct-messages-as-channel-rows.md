# 0005 — Direct messages are channel rows, isolated by participation

Date: 2026-07-05
Status: accepted

## Context

Everything in the app was world-readable within the Space: every Member sees every Channel,
messages are delivered to all connected sockets by `wsBroadcast`, and full-text search spans
every message. Direct messages (1:1 private conversations) are the first feature that must be
visible to only two people, so they need genuine isolation rather than another flat Channel.

The whole message stack — pagination cursors, attachments, reactions, replies, read-state
(`memberChannelState`), the `/api/channels/:id/messages` endpoints, and the `ChannelChat`
component — is keyed on `messages.channelId`. The design question was how much of it to reuse
versus rebuild for privacy.

## Options considered

1. **Separate `dm_conversations` + `dm_messages` tables** — isolation by construction (a DM can't
   leak into channel queries because it's a different table), but duplicates the entire message
   stack: a parallel pagination endpoint, attachment binding, reactions, replies, and read-state.
   Large, permanent maintenance cost for a friend-group app. Rejected.
2. **Shared `messages` table with a new `conversationId` column** — reuses the message machinery
   but makes `channelId` nullable and adds a branch to every existing message query's `WHERE`,
   touching the hottest table and its indexes. Rejected as needless churn on the core path.
3. **A DM conversation IS a `channels` row (`kind='dm'`) + a `channel_participants` table** — the
   message stack works unchanged because a DM channel already satisfies every `channelId` foreign
   key. Isolation moves from the data model into a small set of enforced access points. Chosen.

## Decision

- A 1:1 DM is a `channels` row with `kind='dm'` and `name=''` (its title is derived from the other
  participant). Membership lives in `channel_participants(channelId, memberId)`; text/voice
  channels stay open to all Members and carry no participant rows.
- **Access** is gated by one chokepoint, `requireChannelMember(event, channelId)`: a no-op for
  text/voice, but for a DM it requires the caller be a participant and returns **404** (not 403) to
  outsiders so an endpoint never confirms a DM exists. Every message read/write, reaction,
  read-marker, and DM-bound attachment fetch routes through it.
- **Delivery** is audience-aware: `emitChannelEvent(channel, event)` broadcasts for public channels
  but uses `wsSendToMembers(participantIds, event)` for a DM, so DM traffic never reaches a
  non-participant socket. A new `dm.created` event is sent only to the two participants.
- **Leakage is closed at the edges the flat model left open**: `/api/channels` and `/api/search`
  exclude `kind='dm'`, and admin message-deletion has no reach into DMs it isn't part of.
- Conversations are **get-or-create** via `POST /api/dm {memberId}` (idempotent), listed at
  `GET /api/dm` as `DmConversationDto`s. The client keeps them in a dedicated `useDmStore`, separate
  from the public `useChannelsStore`, and reuses `ChannelChat` for the thread itself.

## Consequences

- The message stack has a single implementation; DMs inherit attachments, reactions, replies,
  search-preview helpers, unread state, and message virtualization for free.
- Privacy is now an invariant maintained by discipline, not by schema: any **new** endpoint that
  reads messages/attachments by id must call `requireChannelMember`, and any new `message.*`
  emit must go through `emitChannelEvent`, or it will leak DM content. This is the main risk the
  chosen option accepts in exchange for the reuse.
- Group DMs are a natural extension (more `channel_participants` rows) but are explicitly out of
  scope for this version; nothing here precludes them.
- Get-or-create is not transactionally guarded against a simultaneous double-open, so two clients
  racing to start the same DM could in principle create two channels. Acceptable at friend-group
  scale; revisit with a participant-set uniqueness guard if it ever bites.
