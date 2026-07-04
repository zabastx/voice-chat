import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const members = sqliteTable('members', {
	id: text('id').primaryKey(),
	username: text('username').notNull().unique(),
	passwordHash: text('password_hash').notNull(),
	displayName: text('display_name'),
	avatarId: text('avatar_id'),
	role: text('role', { enum: ['admin', 'moderator', 'member'] })
		.notNull()
		.default('member'),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
})

export const channels = sqliteTable('channels', {
	id: text('id').primaryKey(),
	name: text('name').notNull(),
	kind: text('kind', { enum: ['text', 'voice'] }).notNull(),
	position: integer('position').notNull().default(0),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date())
})

export const messages = sqliteTable(
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
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date()),
		editedAt: integer('edited_at', { mode: 'timestamp_ms' })
	},
	(table) => [
		index('messages_channel_created_idx').on(table.channelId, table.createdAt),
		// scanned when a parent is deleted to rebroadcast its dangling replies
		index('messages_reply_to_idx').on(table.replyToId)
	]
)

export const attachments = sqliteTable(
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
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	// hit on every message-page load (attachments for 50 message ids)
	(table) => [index('attachments_message_idx').on(table.messageId)]
)

export const reactions = sqliteTable(
	'reactions',
	{
		messageId: text('message_id')
			.notNull()
			.references(() => messages.id, { onDelete: 'cascade' }),
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		emoji: text('emoji').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(table) => [
		primaryKey({ columns: [table.messageId, table.memberId, table.emoji] }),
		index('reactions_message_idx').on(table.messageId)
	]
)

export const invites = sqliteTable('invites', {
	token: text('token').primaryKey(),
	createdBy: text('created_by')
		.notNull()
		.references(() => members.id, { onDelete: 'cascade' }),
	createdAt: integer('created_at', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	usedBy: text('used_by').references(() => members.id, { onDelete: 'set null' }),
	usedAt: integer('used_at', { mode: 'timestamp_ms' })
})

export const memberChannelState = sqliteTable(
	'member_channel_state',
	{
		memberId: text('member_id')
			.notNull()
			.references(() => members.id, { onDelete: 'cascade' }),
		channelId: text('channel_id')
			.notNull()
			.references(() => channels.id, { onDelete: 'cascade' }),
		lastReadAt: integer('last_read_at', { mode: 'timestamp_ms' }).notNull()
	},
	(table) => [primaryKey({ columns: [table.memberId, table.channelId] })]
)
