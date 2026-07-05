import { and, eq, sql } from 'drizzle-orm'
import * as z from 'zod'

const querySchema = z.object({
	q: z.string().trim().min(1).max(100),
	limit: z.coerce.number().int().min(1).max(50).default(25)
})

// Global full-text search across all text channels (single flat space — every
// member sees them all). Matches the generated tsvector column ('russian'
// config stems Cyrillic word forms), ranked by ts_rank; previews are built with
// the shared messagePreview helper so mentions read as @name.
export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const { q, limit } = await getValidatedQuery(event, querySchema.parse)

	// keep only word tokens and prefix-match each (implicit AND); this also
	// neutralises tsquery operators so raw user input can't break the query
	const terms = q.match(/[\p{L}\p{N}]+/gu) ?? []
	if (terms.length === 0) return { results: [] as SearchResultDto[] }
	const match = terms.map((t) => `${t}:*`).join(' & ')

	const db = useDb()
	const tsquery = sql`to_tsquery('russian', ${match})`
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
			// only public text channels are searchable — DM history stays private
			.where(
				and(eq(schema.channels.kind, 'text'), sql`${schema.messages.contentTsv} @@ ${tsquery}`)
			)
			.orderBy(sql`ts_rank(${schema.messages.contentTsv}, ${tsquery}) DESC`)
			.limit(limit),
		db.select({ id: schema.members.id, username: schema.members.username }).from(schema.members)
	])

	const results: SearchResultDto[] = rows.map((row) => ({
		messageId: row.id,
		channelId: row.channelId,
		channelName: row.channelName,
		authorName: row.authorName,
		createdAt: row.createdAt.toISOString(),
		preview: messagePreview(row.content, members, 160)
	}))

	return { results }
})
