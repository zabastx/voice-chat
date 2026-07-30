export interface ChannelDto {
	id: string
	name: string
	kind: 'text' | 'voice'
	position: number
	lastMessageAt: string | null
	lastReadAt: string | null
}

export interface AttachmentDto {
	id: string
	filename: string
	mime: string
	size: number
}

export interface ReplyRefDto {
	id: string
	authorName: string | null
	// plain-text, mention-decoded, markdown-stripped snippet of the parent
	preview: string
	// true when the parent message has since been deleted
	deleted: boolean
}

export interface ReactionDto {
	emoji: string
	count: number
	// members who reacted; the client derives "did I react" from this so a
	// single broadcast DTO is correct for every viewer
	memberIds: string[]
}

export interface MessageDto {
	id: string
	channelId: string
	authorId: string
	authorName: string
	content: string
	createdAt: string
	editedAt: string | null
	attachments: AttachmentDto[]
	replyTo: ReplyRefDto | null
	reactions: ReactionDto[]
	// the channel through which the author posted: 'app' (UI) or 'telegram' (bridge)
	source: 'app' | 'telegram'
}

export interface SearchResultDto {
	messageId: string
	channelId: string
	channelName: string
	authorName: string
	createdAt: string
	// plain-text, mention-decoded excerpt; the client highlights the query
	preview: string
}

// strictly hierarchical: admin ⊃ moderator ⊃ member
export type Role = 'admin' | 'moderator' | 'member'

export interface MemberDto {
	id: string
	username: string
	displayName: string | null
	// '/api/members/{id}/avatar?v={avatarId}' — ?v= busts the img cache on change
	avatarUrl: string | null
	role: Role
	createdAt: string
	// derived: linked to Telegram AND notifications enabled. The chat id and link
	// token stay server-only secrets (adr/0006); only this boolean is public.
	telegramNotifications: boolean
}

// a 1:1 direct-message conversation, from the perspective of the current member;
// `member` is the OTHER participant (the DM's title/avatar are derived from them)
export interface DmConversationDto {
	channelId: string
	member: MemberDto
	lastMessageAt: string | null
	lastReadAt: string | null
}

export interface VoiceParticipant {
	memberId: string
	username: string
	muted: boolean
	speaking: boolean
	screenSharing: boolean
	cameraOn: boolean
}

export type VoiceRooms = Record<string, VoiceParticipant[]>

// A Watch Session: shared playback intent for one Voice Channel (adr/0008).
// Never media — every client renders its own embed and steers it to match.
export interface WatchDto {
	// only YouTube for now; the field exists so adding Twitch doesn't reshape the DTO
	source: 'youtube'
	// the YouTube video id
	ref: string
	paused: boolean
	// PLAYBACK ANCHOR, resolved at send time — the position as of the moment this
	// DTO was serialized, NOT a stored value plus a server timestamp. The client
	// re-anchors on its own performance.now() at arrival, so a wrong device clock
	// cannot poison the drift correction (adr/0008).
	positionSec: number
	// Playback speed, shared like everything else — it is the SLOPE of the anchor,
	// so every calculation that advances a position over elapsed time has to
	// multiply by it. Left unsynced it isn't merely absent: a member watching at
	// 2x advances ~6s per 3s tick, which the drift check reads as a seek and
	// broadcasts, dragging the whole room forward with them.
	rate: number
	// a live broadcast has no meaningful shared timeline: every viewer rides the
	// live edge. Set by whoever started it once their player reports it; until
	// then it's false and the session syncs as a VOD. Live sessions ignore
	// positionSec entirely and sync only paused.
	live: boolean
	// display-only, for the sidebar and the stage header; filled in once any
	// client's player reports it (the embed knows the title, we don't)
	title: string | null
	// member id of whoever last changed the state, for the «Данил перемотал» toast
	actorId: string
}

// parallel to VoiceRooms, keyed by channel id. Deliberately NOT folded into
// VoiceRooms: that's an array of participants with no room-level object, and a
// Watch Session belongs to the room, not to any member (adr/0009).
export type WatchRooms = Record<string, WatchDto>

export type ServerEvent =
	| { type: 'snapshot'; online: string[]; voice: VoiceRooms; watch: WatchRooms }
	| { type: 'presence'; online: string[] }
	| { type: 'voice.state'; voice: VoiceRooms }
	// every connected client, not just the room's occupants — a Watch Session is
	// an invitation, so it shows in the sidebar to people who haven't joined
	| { type: 'watch.state'; watch: WatchRooms }
	| { type: 'channel.created'; channel: ChannelDto }
	| { type: 'channel.updated'; channel: ChannelDto }
	| { type: 'channel.deleted'; channelId: string }
	| { type: 'message.created'; message: MessageDto }
	| { type: 'message.updated'; message: MessageDto }
	| { type: 'message.deleted'; channelId: string; messageId: string }
	| { type: 'member.updated'; member: MemberDto }
	// the member row is gone — clients drop them from the directory (and from any
	// DM list). Never delivered to the removed member: their sockets are closed first
	| { type: 'member.deleted'; memberId: string }
	// a DM conversation involving the recipient was just created — sent only to
	// its two participants so their sidebar list updates without a refetch
	| { type: 'dm.created'; conversation: DmConversationDto }
	| { type: 'auth.error' }
	// client-side synthetic event, emitted after a reconnect so views refetch
	| { type: 'resync' }

export type ClientEvent = { type: 'auth'; ticket: string } | { type: 'voice.self'; muted: boolean }
