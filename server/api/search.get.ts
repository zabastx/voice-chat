import { eq, inArray, sql } from 'drizzle-orm'
import * as z from 'zod'

const querySchema = z.object({
	q: z.string().trim().min(1).max(100),
	limit: z.coerce.number().int().min(1).max(50).default(25)
})

// Global full-text search across all text channels (single flat space — every
// member sees them all). Ranked by FTS5 bm25; details + previews are built with
// the shared messagePreview helper so mentions read as @name.
export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const { q, limit } = await getValidatedQuery(event, querySchema.parse)

	// keep only word tokens and prefix-match each (implicit AND); this also
	// neutralises FTS5 operators so raw user input can't break the MATCH
	const terms = q.match(/[\p{L}\p{N}]+/gu) ?? []
	if (terms.length === 0) return { results: [] as SearchResultDto[] }
	const match = terms.map((t) => `"${t}"*`).join(' ')

	const db = useDb()
	const hits = db.all(
		sql`SELECT message_id as messageId FROM messages_fts WHERE messages_fts MATCH ${match} ORDER BY rank LIMIT ${limit}`
	) as { messageId: string }[]
	if (hits.length === 0) return { results: [] as SearchResultDto[] }
	const ids = hits.map((h) => h.messageId)

	const [rows, members] = await Promise.all([
		db
			.select({
				id: schema.messages.id,
				content: schema.messages.content,
				channelId: schema.messages.channelId,
				channelName: schema.channels.name,
				authorName: schema.members.username,
				createdAt: schema.messages.createdAt
			})
			.from(schema.messages)
			.innerJoin(schema.members, eq(schema.messages.authorId, schema.members.id))
			.innerJoin(schema.channels, eq(schema.messages.channelId, schema.channels.id))
			.where(inArray(schema.messages.id, ids)),
		db.select({ id: schema.members.id, username: schema.members.username }).from(schema.members)
	])

	const byId = new Map(rows.map((r) => [r.id, r]))
	// preserve FTS rank order
	const results: SearchResultDto[] = ids.flatMap((id) => {
		const row = byId.get(id)
		if (!row) return []
		return [
			{
				messageId: row.id,
				channelId: row.channelId,
				channelName: row.channelName,
				authorName: row.authorName,
				createdAt: row.createdAt.toISOString(),
				preview: messagePreview(row.content, members, 160)
			}
		]
	})

	return { results }
})
