# Ubiquitous Language

Glossary for the voice-chat project — a private Discord-style app for one friend group.

- **Space** — the single community this deployment hosts. Implicit; not a stored entity.
- **Channel** — a named room in the Space; kind is `text` or `voice`.
- **Text Channel** — a Channel holding a permanent Message history.
- **Voice Channel** — a Channel members join/leave for live audio and screen share. Persistent (a Discord-style room, not a dial-up call). Maps 1:1 to a LiveKit room.
- **Member** — a registered account. All Members belong to the Space.
- **Role** — a Member's single tier: Admin > Moderator > Member. Strictly hierarchical (each tier holds every power of the tiers below); still no permissions engine.
- **Admin** — the first Member. Holds all Moderator powers plus the destructive and administrative ones: deleting Channels, Members, and other Members' Messages, resetting passwords, and promoting/demoting Moderators. Exactly one.
- **Moderator** — a Member granted organizational powers by the Admin: creating and renaming Channels, and managing Invites. Explicitly _not_ content moderation — no power over Messages or Members. Any number of Moderators; freely revocable by the Admin.
- **Message** — a post by a Member in a Text Channel; editable and deletable by its author, deletable by the Admin.
- **Attachment** — an uploaded file bound to a Message.
- **Invite** — a single-use registration token created by the Admin or a Moderator. Redeeming it is the only way to register (except the very first Member, who becomes the Admin).
- **Presence** — whether a Member is currently connected (online/offline).
- **Voice State** — which Voice Channel a Member is currently in, plus mute/speaking status; visible to all Members without joining.
- **Self-Mute** — a Member muting their own microphone. Broadcast to everyone via Voice State; the whole room stops hearing that Member.
- **Local Volume** — a listener's per-speaker playback level (0–200%, default 100%), applied only in the listener's own browser. Purely client-side: it never touches the speaker's mic or any other listener. Persisted per-device (localStorage), keyed by the speaker's Member id.
- **Local Mute** — a listener silencing one specific speaker for themselves only (Local Volume forced to 0 via a separate flag that preserves the prior level). Distinct from Self-Mute (which is the speaker's own choice, seen by all) and from any server/admin force-mute (which this app does not have).
