import { and, asc, eq, ne, sql } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const db = useDb()
	const rows = await db
		.select({
			id: schema.channels.id,
			name: schema.channels.name,
			kind: schema.channels.kind,
			position: schema.channels.position,
			// correlated subquery seeks messages_channel_created_idx per channel;
			// a LEFT JOIN + GROUP BY here scans the whole messages table instead
			lastMessageAt: sql<number | null>`(
				SELECT max(${schema.messages.createdAt})
				FROM ${schema.messages}
				WHERE ${schema.messages.channelId} = ${schema.channels.id}
			)`,
			lastReadAt: schema.memberChannelState.lastReadAt
		})
		.from(schema.channels)
		.leftJoin(
			schema.memberChannelState,
			and(
				eq(schema.memberChannelState.channelId, schema.channels.id),
				eq(schema.memberChannelState.memberId, user.id)
			)
		)
		// DM channels are private and surfaced via /api/dm, never the public list
		.where(ne(schema.channels.kind, 'dm'))
		.orderBy(asc(schema.channels.position), asc(schema.channels.createdAt))

	return rows.map(
		(row): ChannelDto => ({
			...row,
			// the query excludes kind='dm', so this narrowing is sound
			kind: row.kind as ChannelDto['kind'],
			lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt).toISOString() : null,
			lastReadAt: row.lastReadAt?.toISOString() ?? null
		})
	)
})
