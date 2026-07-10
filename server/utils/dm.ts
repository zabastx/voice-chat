import { and, eq, inArray, ne, sql } from 'drizzle-orm'

// The existing 1:1 DM channel between two members, if any. DM channels always
// have exactly two participants, so a kind='dm' channel containing both ids is
// necessarily the {a, b} conversation.
export async function findDmChannelBetween(a: string, b: string): Promise<string | undefined> {
	const rows = await useDb()
		.select({ channelId: schema.channelParticipants.channelId })
		.from(schema.channelParticipants)
		.innerJoin(schema.channels, eq(schema.channelParticipants.channelId, schema.channels.id))
		.where(
			and(eq(schema.channels.kind, 'dm'), inArray(schema.channelParticipants.memberId, [a, b]))
		)
		.groupBy(schema.channelParticipants.channelId)
		.having(sql`count(*) = 2`)
	return rows[0]?.channelId
}

// member ids participating in a channel (rows only exist for kind='dm')
export async function channelParticipantIds(channelId: string): Promise<string[]> {
	const rows = await useDb()
		.select({ memberId: schema.channelParticipants.memberId })
		.from(schema.channelParticipants)
		.where(eq(schema.channelParticipants.channelId, channelId))
	return rows.map((r) => r.memberId)
}

// Route a message.* event to the correct audience: every connected client for a
// public (text/voice) channel, but only the two participants for a DM — so DM
// traffic never touches non-participant sockets.
export async function emitChannelEvent(
	channel: { id: string; kind: 'text' | 'voice' | 'dm' },
	event: ServerEvent
) {
	if (channel.kind === 'dm') {
		wsSendToMembers(await channelParticipantIds(channel.id), event)
	} else {
		wsBroadcast(event)
	}
}

// Build the DM conversation DTO from `viewerId`'s perspective: `member` is the
// OTHER participant, and lastReadAt is the viewer's own read cursor.
export async function dmConversationDto(
	channelId: string,
	viewerId: string
): Promise<DmConversationDto | null> {
	const db = useDb()
	const [other] = await db
		.select({
			id: schema.members.id,
			username: schema.members.username,
			displayName: schema.members.displayName,
			avatarId: schema.members.avatarId,
			role: schema.members.role,
			createdAt: schema.members.createdAt,
			telegramChatId: schema.members.telegramChatId,
			telegramNotificationsEnabled: schema.members.telegramNotificationsEnabled
		})
		.from(schema.channelParticipants)
		.innerJoin(schema.members, eq(schema.channelParticipants.memberId, schema.members.id))
		.where(
			and(
				eq(schema.channelParticipants.channelId, channelId),
				ne(schema.channelParticipants.memberId, viewerId)
			)
		)
		.limit(1)
	if (!other) return null

	const [lastMessage] = await db
		// a raw sql aggregate has no inferred column type, so postgres.js returns
		// the timestamp as a string — normalise through Date (cf. channels/index.get)
		.select({ at: sql<string | null>`max(${schema.messages.createdAt})` })
		.from(schema.messages)
		.where(eq(schema.messages.channelId, channelId))
	const state = await db.query.memberChannelState.findFirst({
		where: and(
			eq(schema.memberChannelState.memberId, viewerId),
			eq(schema.memberChannelState.channelId, channelId)
		)
	})

	return {
		channelId,
		member: memberDto(other),
		lastMessageAt: lastMessage?.at ? new Date(lastMessage.at).toISOString() : null,
		lastReadAt: state?.lastReadAt?.toISOString() ?? null
	}
}
