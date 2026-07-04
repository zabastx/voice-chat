import { and, asc, desc, eq, gt, lt, lte, or, type SQL } from 'drizzle-orm'
import * as z from 'zod'

const querySchema = z.object({
	before: z.iso.datetime().optional(),
	// id tiebreaker for `before`: rows can share a createdAt millisecond, and a
	// strict timestamp cursor would skip the twins across a page boundary
	beforeId: z.string().optional(),
	// symmetric forward cursor, used when the client scrolls back down through a
	// window whose live tail was trimmed away (message virtualization)
	after: z.iso.datetime().optional(),
	afterId: z.string().optional(),
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
	// hasMore = older messages exist before rows[0]; hasMoreNewer = newer exist
	// after the last row (only the live-tail page can be sure there are none)
	let hasMore: boolean
	let hasMoreNewer = false

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
			WINDOW + 1
		)
		hasMore = older.length > WINDOW
		hasMoreNewer = newer.length > WINDOW
		rows = [...older.slice(0, WINDOW).reverse(), ...newer.slice(0, WINDOW)]
	} else if (query.after) {
		// page forward: the oldest `limit` messages newer than the cursor
		const after = new Date(query.after)
		const cursor = query.afterId
			? or(
					gt(schema.messages.createdAt, after),
					and(eq(schema.messages.createdAt, after), gt(schema.messages.id, query.afterId))
				)
			: gt(schema.messages.createdAt, after)
		const page = await selectMessages(and(channelFilter, cursor), 'asc', query.limit)
		hasMoreNewer = page.length === query.limit
		hasMore = true // there is always older history behind a forward page
		rows = page
	} else {
		const before = query.before ? new Date(query.before) : undefined
		// matches the (createdAt, id) sort order of selectMessages
		const cursor = before
			? query.beforeId
				? or(
						lt(schema.messages.createdAt, before),
						and(eq(schema.messages.createdAt, before), lt(schema.messages.id, query.beforeId))
					)
				: lt(schema.messages.createdAt, before)
			: undefined
		const page = await selectMessages(and(channelFilter, cursor), 'desc', query.limit)
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

	return { messages, hasMore, hasMoreNewer }
})
