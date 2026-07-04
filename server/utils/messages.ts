import { eq, inArray } from 'drizzle-orm'

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
	const [attachments, refs] = await Promise.all([
		attachmentDtosFor([row.id]),
		replyToId ? replyRefsFor([replyToId]) : Promise.resolve(new Map<string, ReplyRefDto>())
	])
	return {
		...rest,
		createdAt: row.createdAt.toISOString(),
		editedAt: row.editedAt?.toISOString() ?? null,
		attachments: attachments.get(row.id) ?? [],
		replyTo: resolveReplyRef(replyToId, refs)
	}
}
