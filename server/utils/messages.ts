import { and, asc, eq, inArray, isNull } from 'drizzle-orm'

// Batch-load reactions grouped by message, then by emoji in first-reacted
// order. `me` is intentionally omitted — the client derives it from memberIds
// so one broadcast DTO is correct for every viewer.
export async function reactionsFor(messageIds: string[]): Promise<Map<string, ReactionDto[]>> {
	const map = new Map<string, ReactionDto[]>()
	if (messageIds.length === 0) return map
	const rows = await useDb()
		.select({
			messageId: schema.reactions.messageId,
			memberId: schema.reactions.memberId,
			emoji: schema.reactions.emoji
		})
		.from(schema.reactions)
		.where(inArray(schema.reactions.messageId, messageIds))
		.orderBy(asc(schema.reactions.createdAt))
	for (const row of rows) {
		let list = map.get(row.messageId)
		if (!list) {
			list = []
			map.set(row.messageId, list)
		}
		let entry = list.find((r) => r.emoji === row.emoji)
		if (!entry) {
			entry = { emoji: row.emoji, count: 0, memberIds: [] }
			list.push(entry)
		}
		entry.count++
		entry.memberIds.push(row.memberId)
	}
	return map
}

// Convert `@username` mentions in freshly written content to canonical `<@id>`
// tokens. Called on send and edit so stored content is always canonical.
export async function encodeMessageMentions(content: string): Promise<string> {
	if (!content.includes('@')) return content
	const members = await useDb()
		.select({ id: schema.members.id, username: schema.members.username })
		.from(schema.members)
	return encodeMentions(content, members)
}

export async function attachmentDtosFor(messageIds: string[]) {
	const map = new Map<string, AttachmentDto[]>()
	if (messageIds.length === 0) return map
	const rows = await useDb()
		.select()
		.from(schema.attachments)
		.where(inArray(schema.attachments.messageId, messageIds))
	for (const row of rows) {
		const dto: AttachmentDto = {
			id: row.id,
			filename: row.filename,
			mime: row.mime,
			size: row.size
		}
		const list = map.get(row.messageId!) ?? []
		list.push(dto)
		map.set(row.messageId!, list)
	}
	return map
}

// Plain-text snippet of a message for reply quotes / search results: mentions
// decoded to @name, markdown markers stripped, whitespace collapsed.
export function messagePreview(
	content: string,
	members: { id: string; username: string }[],
	max = 120
): string {
	const text = decodeMentions(content, members)
		.replace(/```[\s\S]*?```/g, '[код]')
		.replace(/`([^`]*)`/g, '$1')
		.replace(/[*_~]/g, '')
		.replace(/^\s*>\s?/gm, '')
		.replace(/\s+/g, ' ')
		.trim()
	return text.length > max ? `${text.slice(0, max)}…` : text
}

// Batch-resolve the parent messages that a set of replies point to.
export async function replyRefsFor(parentIds: string[]): Promise<Map<string, ReplyRefDto>> {
	const map = new Map<string, ReplyRefDto>()
	const ids = [...new Set(parentIds)]
	if (ids.length === 0) return map
	const db = useDb()
	const [rows, members] = await Promise.all([
		db
			.select({
				id: schema.messages.id,
				authorName: schema.members.username,
				content: schema.messages.content
			})
			.from(schema.messages)
			.innerJoin(schema.members, eq(schema.messages.authorId, schema.members.id))
			.where(inArray(schema.messages.id, ids)),
		db.select({ id: schema.members.id, username: schema.members.username }).from(schema.members)
	])
	for (const row of rows) {
		map.set(row.id, {
			id: row.id,
			authorName: row.authorName,
			preview: messagePreview(row.content, members),
			deleted: false
		})
	}
	return map
}

// A reply reference for a parent that no longer exists.
export function resolveReplyRef(
	replyToId: string | null,
	refs: Map<string, ReplyRefDto>
): ReplyRefDto | null {
	if (!replyToId) return null
	return refs.get(replyToId) ?? { id: replyToId, authorName: null, preview: '', deleted: true }
}

// Persist a channel/DM message and fan it out: insert, claim the author's own
// attachments, mark the author's read cursor, build the DTO, broadcast it to the
// right audience, and notify offline recipients over Telegram. Shared by the HTTP
// send route and the Telegram reply webhook so both produce identical messages.
// `content` must already be canonical (`<@id>` tokens); `replyToId` must already
// be validated against this channel by the caller.
export async function createChannelMessage(opts: {
	channel: { id: string; kind: 'text' | 'voice' | 'dm'; name: string }
	authorId: string
	content: string
	replyToId?: string | null
	attachmentIds?: string[]
}): Promise<MessageDto> {
	const db = useDb()
	const message = {
		id: newId(),
		channelId: opts.channel.id,
		authorId: opts.authorId,
		content: opts.content,
		replyToId: opts.replyToId ?? null,
		createdAt: new Date()
	}
	await db.insert(schema.messages).values(message)

	if (opts.attachmentIds && opts.attachmentIds.length > 0) {
		// claim only this member's own unbound uploads; anything else is silently dropped
		await db
			.update(schema.attachments)
			.set({ messageId: message.id })
			.where(
				and(
					inArray(schema.attachments.id, opts.attachmentIds),
					eq(schema.attachments.uploaderId, opts.authorId),
					isNull(schema.attachments.messageId)
				)
			)
	}

	// the author has obviously read their own message
	await db
		.insert(schema.memberChannelState)
		.values({ memberId: opts.authorId, channelId: opts.channel.id, lastReadAt: message.createdAt })
		.onConflictDoUpdate({
			target: [schema.memberChannelState.memberId, schema.memberChannelState.channelId],
			set: { lastReadAt: message.createdAt }
		})

	const dto = (await messageDto(message.id))!
	// broadcast to everyone for text channels, only the two participants for a DM
	await emitChannelEvent(opts.channel, { type: 'message.created', message: dto })
	// bridge to Telegram for offline recipients (fire-and-forget; never blocks the send)
	void notifyOffline(opts.channel, dto).catch((err) => console.error('telegram notify failed', err))
	return dto
}

export async function messageDto(messageId: string): Promise<MessageDto | null> {
	const db = useDb()
	const [row] = await db
		.select({
			id: schema.messages.id,
			channelId: schema.messages.channelId,
			authorId: schema.messages.authorId,
			authorName: schema.members.username,
			content: schema.messages.content,
			replyToId: schema.messages.replyToId,
			createdAt: schema.messages.createdAt,
			editedAt: schema.messages.editedAt
		})
		.from(schema.messages)
		.innerJoin(schema.members, eq(schema.messages.authorId, schema.members.id))
		.where(eq(schema.messages.id, messageId))
		.limit(1)
	if (!row) return null
	const { replyToId, ...rest } = row
	const [attachments, refs, reactionMap] = await Promise.all([
		attachmentDtosFor([row.id]),
		replyToId ? replyRefsFor([replyToId]) : Promise.resolve(new Map<string, ReplyRefDto>()),
		reactionsFor([row.id])
	])
	return {
		...rest,
		createdAt: row.createdAt.toISOString(),
		editedAt: row.editedAt?.toISOString() ?? null,
		attachments: attachments.get(row.id) ?? [],
		replyTo: resolveReplyRef(replyToId, refs),
		reactions: reactionMap.get(row.id) ?? []
	}
}
