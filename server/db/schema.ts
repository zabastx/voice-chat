import { sql } from 'drizzle-orm'
import {
	bigint,
	boolean,
	customType,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex
} from 'drizzle-orm/pg-core'

// full-text search vector; drizzle has no built-in tsvector type
const tsvector = customType<{ data: string }>({
	dataType() {
		return 'tsvector'
	}
})

export const members = pgTable('members', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	displayName: text('display_name'),
	avatarId: text('avatar_id'),
	role: text('role', { enum: ['admin', 'moderator', 'member'] })
		.notNull()
		.default('member'),
	// Telegram bridge. chatId is null until the member links their account; the raw
	// chatId and link token are SECRETS — never surfaced in memberDto or the session
	// cookie; only the derived `telegramNotifications` boolean is public (see adr/0006).
	telegramChatId: text('telegram_chat_id'),
	telegramNotificationsEnabled: boolean('telegram_notifications_enabled').notNull().default(true),
	// single-use deep-link token; cleared once the bot consumes `/start <token>`
	telegramLinkToken: text('telegram_link_token'),
	telegramLinkTokenExpiresAt: timestamp('telegram_link_token_expires_at', { withTimezone: true }),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.$defaultFn(() => new Date())
})

export const channels = pgTable('channels', {
	id: text('id').primaryKey(),
	// empty for DM channels — their title is derived from the other participant
	name: text('name').notNull(),
	kind: text('kind', { enum: ['text', 'voice', 'dm'] }).notNull(),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.$defaultFn(() => new Date())
})

// membership of a DM channel (kind='dm'). Text/voice channels are open to every
// member and carry no rows here; access to a DM is gated on participation.
export const channelParticipants = pgTable(
	'channel_participants',
	{
		channelId: text('channel_id')
			.notNull()
			.references(() => channels.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		primaryKey({ columns: [table.channelId, table.memberId] }),
		// "my conversations" lists every DM channel a member participates in
		index('channel_participants_member_idx').on(table.memberId)
	]
)

export const messages = pgTable(
	'messages',
	{
		id: text('id').primaryKey(),
		channelId: text('channel_id')
			.notNull()
			.references(() => channels.id, { onDelete: 'cascade' }),
		authorId: text('author_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		content: text('content').notNull(),
		// id of the message this one replies to. Deliberately NOT a foreign key:
		// when the parent is deleted the reference dangles so we can still show
		// "исходное сообщение удалено" instead of silently losing the reply.
		replyToId: text('reply_to_id'),
		// the channel through which the author posted this message: the app UI
		// ('app') or the Telegram bridge ('telegram'). Set once at creation; an
		// edit in-app does not change it. See adr/0007.
		source: text('source', { enum: ['app', 'telegram'] })
			.notNull()
			.default('app'),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.$defaultFn(() => new Date()),
		editedAt: timestamp('edited_at', { withTimezone: true }),
		// keeps itself in sync (STORED generated) — powers /api/search
		contentTsv: tsvector('content_tsv').generatedAlwaysAs(sql`to_tsvector('russian', content)`)
	},
	(table) => [
		index('messages_channel_created_idx').on(table.channelId, table.createdAt),
		// scanned when a parent is deleted to rebroadcast its dangling replies
		index('messages_reply_to_idx').on(table.replyToId),
		index('messages_content_tsv_idx').using('gin', table.contentTsv)
	]
)

export const attachments = pgTable(
	'attachments',
	{
		id: text('id').primaryKey(),
		// null until the message referencing this upload is sent
		messageId: text('message_id').references(() => messages.id, { onDelete: 'cascade' }),
		uploaderId: text('uploader_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		filename: text('filename').notNull(),
		mime: text('mime').notNull(),
		size: integer('size').notNull(),
		objectKey: text('object_key').notNull().unique(),
		// downscaled WebP preview for in-chat display; null = no preview
		// (non-image, gif/svg, or generation failed) → the original is served
		previewKey: text('preview_key'),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.$defaultFn(() => new Date())
	},
	// hit on every message-page load (attachments for 50 message ids)
	(table) => [index('attachments_message_idx').on(table.messageId)]
)

export const reactions = pgTable(
	'reactions',
	{
		messageId: text('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		primaryKey({ columns: [table.messageId, table.memberId, table.emoji] }),
		index('reactions_message_idx').on(table.messageId)
	]
)

export const invites = pgTable('invites', {
	token: text('token').primaryKey(),
	createdBy: text('created_by')
		.notNull()
		.references(() => members.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.$defaultFn(() => new Date()),
	usedBy: text('used_by').references(() => members.id, { onDelete: 'set null' }),
	usedAt: timestamp('used_at', { withTimezone: true })
})

// Maps a notification the bot delivered back to the app context, so a Telegram
// reply lands in the right channel/DM authored by the right member. Rows are
// swept after 7 days (server/plugins/telegram.ts); a reply to an older/expired
// notification falls through to the "reply to a recent notification" hint.
export const telegramNotifications = pgTable(
	'telegram_notifications',
	{
		id: text('id').primaryKey(),
		// the member a reply is posted AS (the notification's recipient)
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		// recipient's Telegram chat — half of the reply lookup key
		chatId: text('chat_id').notNull(),
		// the bot message the user replies to — the other half of the lookup key
		telegramMessageId: bigint('telegram_message_id', { mode: 'number' }).notNull(),
		// where the reply is posted
		channelId: text('channel_id')
			.notNull()
			.references(() => channels.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		// reply routing looks up by (chat, replied-to message id); unique because a
		// Telegram message id is unique within a chat — also a guard against a reply
		// ever resolving to two different members
		uniqueIndex('telegram_notifications_lookup_idx').on(table.chatId, table.telegramMessageId)
	]
)

export const memberChannelState = pgTable(
	'member_channel_state',
	{
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		channelId: text('channel_id')
			.notNull()
			.references(() => channels.id, { onDelete: 'cascade' }),
		lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull()
	},
	(table) => [primaryKey({ columns: [table.memberId, table.channelId] })]
)
