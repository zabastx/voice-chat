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
	// Messenger links live in member_notification_links, one row per transport —
	// they used to be telegram_-prefixed columns here (see adr/0011).
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
		// ('app') or a messenger bridge ('telegram', 'vk'). Set once at creation;
		// an edit in-app does not change it. See adr/0007 and adr/0011.
		source: text('source', { enum: ['app', 'telegram', 'vk'] })
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

// A member's opt-in binding to one messenger. One row per (member, transport);
// replaces the telegram_* columns that used to live on `members` (adr/0011).
// `externalId` (Telegram chat id / VK peer id) and `linkToken` are SECRETS —
// never in a member DTO or the session cookie. Only the derived reachability
// boolean is public. A VK peer id is additionally the member's public VK user
// id, so leaking one deanonymises them; treat it at least as carefully.
export const memberNotificationLinks = pgTable(
	'member_notification_links',
	{
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		transport: text('transport', { enum: ['telegram', 'vk'] }).notNull(),
		// null while a link token is minted but not yet consumed — the row is
		// created at mint time, so "linked" means externalId is set, not row exists
		externalId: text('external_id'),
		notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
		// single-use deep-link token, consumed by /start <token> (Telegram) or by
		// `ref` on the «Начать» press (VK)
		linkToken: text('link_token'),
		linkTokenExpiresAt: timestamp('link_token_expires_at', { withTimezone: true }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		primaryKey({ columns: [table.memberId, table.transport] }),
		// one messenger account links to at most one member per transport
		uniqueIndex('member_notification_links_external_idx').on(table.transport, table.externalId)
	]
)

// Maps a notification the bot delivered back to the app context, so a reply in
// the messenger lands in the right channel/DM authored by the right member.
// Rows are swept after 7 days (server/plugins/notifications.ts); a reply to an
// older/expired notification falls through to the "reply to a recent one" hint.
export const notificationMappings = pgTable(
	'notification_mappings',
	{
		id: text('id').primaryKey(),
		transport: text('transport', { enum: ['telegram', 'vk'] }).notNull(),
		// the member a reply is posted AS (the notification's recipient)
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		// recipient's Telegram chat / VK peer — half of the reply lookup key
		externalChatId: text('external_chat_id').notNull(),
		// the bot message the user replies to — the other half of the lookup key
		externalMessageId: bigint('external_message_id', { mode: 'number' }).notNull(),
		// VK only. VK has two id spaces and the docs warn the common message id
		// "may be absent in some cases", so a reply is matched against either —
		// which is why this is a second column and not a rename (adr/0011).
		conversationMessageId: bigint('conversation_message_id', { mode: 'number' }),
		// where the reply is posted
		channelId: text('channel_id')
			.notNull()
			.references(() => channels.id, { onDelete: 'cascade' }),
		createdAt: timestamp('created_at', { withTimezone: true })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		// unique because a message id is unique within a chat — also a guard against
		// a reply ever resolving to two different members
		uniqueIndex('notification_mappings_lookup_idx').on(
			table.transport,
			table.externalChatId,
			table.externalMessageId
		),
		index('notification_mappings_cmid_idx').on(
			table.transport,
			table.externalChatId,
			table.conversationMessageId
		)
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
