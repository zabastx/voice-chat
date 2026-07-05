import { sql } from 'drizzle-orm'
import {
	customType,
	index,
	integer,
	pgTable,
	primaryKey,
	text,
	timestamp
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
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.$defaultFn(() => new Date())
})

export const channels = pgTable('channels', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	kind: text('kind', { enum: ['text', 'voice'] }).notNull(),
	position: integer('position').notNull().default(0),
	createdAt: timestamp('created_at', { withTimezone: true })
		.notNull()
		.$defaultFn(() => new Date())
})

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
