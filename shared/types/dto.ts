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

export type ServerEvent =
	| { type: 'snapshot'; online: string[]; voice: VoiceRooms }
	| { type: 'presence'; online: string[] }
	| { type: 'voice.state'; voice: VoiceRooms }
	| { type: 'channel.created'; channel: ChannelDto }
	| { type: 'channel.updated'; channel: ChannelDto }
	| { type: 'channel.deleted'; channelId: string }
	| { type: 'message.created'; message: MessageDto }
	| { type: 'message.updated'; message: MessageDto }
	| { type: 'message.deleted'; channelId: string; messageId: string }
	| { type: 'member.updated'; member: MemberDto }
	| { type: 'auth.error' }
	// client-side synthetic event, emitted after a reconnect so views refetch
	| { type: 'resync' }

export type ClientEvent = { type: 'auth'; ticket: string } | { type: 'voice.self'; muted: boolean }
