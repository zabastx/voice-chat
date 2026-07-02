# Ubiquitous Language

Glossary for the voice-chat project — a private Discord-style app for one friend group.

- **Space** — the single community this deployment hosts. Implicit; not a stored entity.
- **Channel** — a named room in the Space; kind is `text` or `voice`.
- **Text Channel** — a Channel holding a permanent Message history.
- **Voice Channel** — a Channel members join/leave for live audio and screen share. Persistent (a Discord-style room, not a dial-up call). Maps 1:1 to a LiveKit room.
- **Member** — a registered account. All Members belong to the Space.
- **Admin** — the Member who manages Channels, Invites, and Members. Exactly one role above Member; there is no permissions engine.
- **Message** — a post by a Member in a Text Channel; editable and deletable by its author, deletable by the Admin.
- **Attachment** — an uploaded file bound to a Message.
- **Invite** — a single-use registration token created by the Admin. Redeeming it is the only way to register (except the very first Member, who becomes the Admin).
- **Presence** — whether a Member is currently connected (online/offline).
- **Voice State** — which Voice Channel a Member is currently in, plus mute/speaking status; visible to all Members without joining.
