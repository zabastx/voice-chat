import { and, asc, desc, eq, gt, lt, lte, type SQL } from 'drizzle-orm'
import * as z from 'zod'

const querySchema = z.object({
	before: z.iso.datetime().optional(),
	// center a window on the message at this timestamp (reply / search jump)
	around: z.iso.datetime().optional(),
	limit: z.coerce.number().int().min(1).max(100).default(50)
})

// messages either side of the target when using `around`
const WINDOW = 25

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const channelId = getRouterParam(event, 'id')!
	const query = await getValidatedQuery(event, querySchema.parse)
	const db = useDb()

	function selectMessages(where: SQL | undefined, order: 'asc' | 'desc', limit: number) {
		const createdAt = schema.messages.createdAt
		const id = schema.messages.id
		return db
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
			.where(where)
			.orderBy(
				order === 'asc' ? asc(createdAt) : desc(createdAt),
				order === 'asc' ? asc(id) : desc(id)
			)
			.limit(limit)
	}

	const channelFilter = eq(schema.messages.channelId, channelId)

	// rows in ascending (oldest → newest) order regardless of query mode
	let rows: Awaited<ReturnType<typeof selectMessages>>
	let hasMore: boolean

	if (query.around) {
		const target = new Date(query.around)
		const older = await selectMessages(
			and(channelFilter, lte(schema.messages.createdAt, target)),
			'desc',
			WINDOW + 1
		)
		const newer = await selectMessages(
			and(channelFilter, gt(schema.messages.createdAt, target)),
			'asc',
			WINDOW
		)
		hasMore = older.length > WINDOW
		rows = [...older.slice(0, WINDOW).reverse(), ...newer]
	} else {
		const page = await selectMessages(
			and(
				channelFilter,
				query.before ? lt(schema.messages.createdAt, new Date(query.before)) : undefined
			),
			'desc',
			query.limit
		)
		hasMore = page.length === query.limit
		rows = page.reverse()
	}

	const attachments = await attachmentDtosFor(rows.map((row) => row.id))
	const messages = rows.map(
		(row): MessageDto => ({
			...row,
			createdAt: row.createdAt.toISOString(),
			editedAt: row.editedAt?.toISOString() ?? null,
			attachments: attachments.get(row.id) ?? []
		})
	)

	return { messages, hasMore }
})
