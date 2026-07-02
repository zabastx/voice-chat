import { and, asc, eq, max } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const db = useDb()
	const rows = await db
		.select({
			id: schema.channels.id,
			name: schema.channels.name,
			kind: schema.channels.kind,
			position: schema.channels.position,
			lastMessageAt: max(schema.messages.createdAt),
			lastReadAt: schema.memberChannelState.lastReadAt
		})
		.from(schema.channels)
		.leftJoin(schema.messages, eq(schema.messages.channelId, schema.channels.id))
		.leftJoin(
			schema.memberChannelState,
			and(
				eq(schema.memberChannelState.channelId, schema.channels.id),
				eq(schema.memberChannelState.memberId, user.id)
			)
		)
		.groupBy(schema.channels.id)
		.orderBy(asc(schema.channels.position), asc(schema.channels.createdAt))

	return rows.map(
		(row): ChannelDto => ({
			...row,
			lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
			lastReadAt: row.lastReadAt?.toISOString() ?? null
		})
	)
})
