import { and, desc, eq, lt } from 'drizzle-orm'
import * as z from 'zod'

const querySchema = z.object({
	before: z.iso.datetime().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50)
})

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const channelId = getRouterParam(event, 'id')!
	const query = await getValidatedQuery(event, querySchema.parse)
	const db = useDb()

	const rows = await db
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
		.where(
			and(
				eq(schema.messages.channelId, channelId),
				query.before ? lt(schema.messages.createdAt, new Date(query.before)) : undefined
			)
		)
		.orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
		.limit(query.limit)

	const attachments = await attachmentDtosFor(rows.map((row) => row.id))
	const messages = rows
		.map(
			(row): MessageDto => ({
				...row,
				createdAt: row.createdAt.toISOString(),
				editedAt: row.editedAt?.toISOString() ?? null,
				attachments: attachments.get(row.id) ?? []
			})
		)
		.reverse()

	return { messages, hasMore: rows.length === query.limit }
})
