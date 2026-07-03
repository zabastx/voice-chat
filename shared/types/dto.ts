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

export interface MessageDto {
	id: string
	channelId: string
	authorId: string
	authorName: string
	content: string
	createdAt: string
	editedAt: string | null
	attachments: AttachmentDto[]
}

export interface MemberDto {
	id: string
	username: string
	displayName: string | null
	// '/api/members/{id}/avatar?v={avatarId}' — ?v= busts the img cache on change
	avatarUrl: string | null
	isAdmin: boolean
	createdAt: string
}

export interface VoiceParticipant {
	memberId: string
	username: string
	muted: boolean
	speaking: boolean
	screenSharing: boolean
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
