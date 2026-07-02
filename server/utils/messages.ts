import { eq, inArray } from 'drizzle-orm'

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

export async function messageDto(messageId: string): Promise<MessageDto | null> {
	const db = useDb()
	const [row] = await db
		.select({
			id: schema.messages.id,
			channelId: schema.messages.channelId,
			authorId: schema.messages.authorId,
			authorName: schema.members.username,
			content: schema.messages.content,
			createdAt: schema.messages.createdAt,
			editedAt: schema.messages.editedAt
		})
		.from(schema.messages)
		.innerJoin(schema.members, eq(schema.messages.authorId, schema.members.id))
		.where(eq(schema.messages.id, messageId))
		.limit(1)
	if (!row) return null
	const attachments = await attachmentDtosFor([row.id])
	return {
		...row,
		createdAt: row.createdAt.toISOString(),
		editedAt: row.editedAt?.toISOString() ?? null,
		attachments: attachments.get(row.id) ?? []
	}
}
