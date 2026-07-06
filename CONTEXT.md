# Ubiquitous Language

Glossary for the voice-chat project — a private Discord-style app for one friend group.

- **Space** — the single community this deployment hosts. Implicit; not a stored entity.
- **Channel** — a room the Space hosts; kind is `text`, `voice`, or `dm`. Text and Voice Channels are public to every Member; a `dm` Channel is a private DM Conversation (below) and never appears in the public Channel list or search.
- **Text Channel** — a Channel holding a permanent Message history.
- **Voice Channel** — a Channel members join/leave for live audio and screen share. Persistent (a Discord-style room, not a dial-up call). Maps 1:1 to a LiveKit room.
- **Member** — a registered account. All Members belong to the Space.
- **Role** — a Member's single tier: Admin > Moderator > Member. Strictly hierarchical (each tier holds every power of the tiers below); still no permissions engine.
- **Admin** — the first Member. Holds all Moderator powers plus the destructive and administrative ones: deleting Channels, Members, and other Members' Messages, resetting passwords, and promoting/demoting Moderators. Exactly one.
- **Moderator** — a Member granted organizational powers by the Admin: creating and renaming Channels, and managing Invites. Explicitly _not_ content moderation — no power over Messages or Members. Any number of Moderators; freely revocable by the Admin.
- **Message** — a post by a Member in a Text Channel or a DM Conversation; editable and deletable by its author. The Admin may delete Messages in Text Channels, but has no reach into a DM Conversation they are not a Participant of.
- **Message Source** — the channel through which the author posted a Message: the app UI (`app`) or the Telegram bridge (`telegram`). Set once at creation; an edit in-app does not change it. Surfaced as a "через Telegram" badge so a Telegram reply is distinguishable from a native send.
- **Attachment** — an uploaded file bound to a Message.
- **Direct Message (DM)** — a private, strictly 1:1 conversation between two Members. Reuses the whole Message stack; only its two Participants can read, write, or search it.
- **DM Conversation** — the entity backing a DM: a Channel of kind `dm` with an empty name (its title/avatar are derived from the other Participant). Created on demand, get-or-create, from either Member.
- **Participant** — a Member belonging to a DM Conversation (rows in `channel_participants`). Public Channels have no Participants; access to a DM is gated on Participation.
- **Audience** — the delivery scope of a realtime Message event: every connected client for a public Channel (broadcast), or only the two Participants for a DM Conversation (targeted). Keeps DM traffic off non-participant sockets.
- **Invite** — a single-use registration token created by the Admin or a Moderator. Redeeming it is the only way to register (except the very first Member, who becomes the Admin).
- **Presence** — whether a Member is currently connected (online/offline). A Member is _offline_ exactly when they have no live WebSocket connection (`wsOnline()`); this is the trigger condition for a Telegram Notification.
- **Telegram Link** — the opt-in binding between a Member and a Telegram chat, established via a Linking Token. Stored as the Member's `telegram_chat_id` — a secret that never appears in a Member DTO or the session cookie; a Member sees only their own status via `GET /api/me/telegram`.
- **Linking Token** — a short-lived (15 min), single-use secret embedded in the `t.me/<bot>?start=<token>` deep link. The bot consumes it on `/start` to bind the sender's chat to the Member.
- **Telegram Notification** — a message the bot sends to an offline, linked Member when they are `@`-mentioned in a Text Channel or receive any DM. Contains the sender, place, full text (URLs preserved as bare clickable links, markdown stripped), and any Attachments forwarded via the matching Telegram send method (voice → `sendVoice`, image → `sendPhoto`, video → `sendVideo`, other → `sendDocument`).
- **Notification Mapping** — a stored row `{chat_id, telegram_message_id, member_id, channel_id}` recorded for each Telegram Notification, so a Telegram reply can be routed back to the exact Channel/DM as the right Member. Swept after 7 days.
- **Reply-to-send** — replying to a Telegram Notification posts the reply back into the app: resolved through the Notification Mapping, run through the normal Message send path (mentions encoded, same Audience), authored as the linked Member.
- **Voice State** — which Voice Channel a Member is currently in, plus mute/speaking status; visible to all Members without joining.
- **Self-Mute** — a Member muting their own microphone. Broadcast to everyone via Voice State; the whole room stops hearing that Member.
- **Local Volume** — a listener's per-speaker playback level (0–200%, default 100%), applied only in the listener's own browser. Purely client-side: it never touches the speaker's mic or any other listener. Persisted per-device (localStorage), keyed by the speaker's Member id.
- **Local Mute** — a listener silencing one specific speaker for themselves only (Local Volume forced to 0 via a separate flag that preserves the prior level). Distinct from Self-Mute (which is the speaker's own choice, seen by all) and from any server/admin force-mute (which this app does not have).
