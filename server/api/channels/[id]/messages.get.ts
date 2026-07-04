import { and, asc, desc, eq, gt, lt, lte, type SQL } from 'drizzle-orm'
import * as z from 'zod'

const querySchema = z.object({
	before: z.iso.datetime().optional(),
	// center a window on this message (reply / search jump)
	aroundId: z.string().optional(),
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
				replyToId: schema.messages.replyToId,
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

	const target = query.aroundId
		? await db.query.messages.findFirst({
				where: and(eq(schema.messages.id, query.aroundId), channelFilter)
			})
		: undefined

	if (target) {
		const older = await selectMessages(
			and(channelFilter, lte(schema.messages.createdAt, target.createdAt)),
			'desc',
			WINDOW + 1
		)
		const newer = await selectMessages(
			and(channelFilter, gt(schema.messages.createdAt, target.createdAt)),
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

	const [attachments, replyRefs, reactionMap] = await Promise.all([
		attachmentDtosFor(rows.map((row) => row.id)),
		replyRefsFor(rows.flatMap((row) => (row.replyToId ? [row.replyToId] : []))),
		reactionsFor(rows.map((row) => row.id))
	])
	const messages = rows.map(
		({ replyToId, ...rest }): MessageDto => ({
			...rest,
			createdAt: rest.createdAt.toISOString(),
			editedAt: rest.editedAt?.toISOString() ?? null,
			attachments: attachments.get(rest.id) ?? [],
			replyTo: resolveReplyRef(replyToId, replyRefs),
			reactions: reactionMap.get(rest.id) ?? []
		})
	)

	return { messages, hasMore }
})
