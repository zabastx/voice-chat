import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const channelId = getRouterParam(event, 'id')!
	const db = useDb()
	// without this an unknown id surfaces as an FK-constraint 500
	const channel = await db.query.channels.findFirst({ where: eq(schema.channels.id, channelId) })
	if (!channel) {
		throw createError({ statusCode: 404, message: 'Канал не найден' })
	}
	const now = new Date()
	await db
		.insert(schema.memberChannelState)
		.values({ memberId: user.id, channelId, lastReadAt: now })
		.onConflictDoUpdate({
			target: [schema.memberChannelState.memberId, schema.memberChannelState.channelId],
			set: { lastReadAt: now }
		})
	return { ok: true }
})
