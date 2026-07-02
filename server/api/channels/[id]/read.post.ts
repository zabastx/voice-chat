export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const channelId = getRouterParam(event, 'id')!
	const now = new Date()
	await useDb()
		.insert(schema.memberChannelState)
		.values({ memberId: user.id, channelId, lastReadAt: now })
		.onConflictDoUpdate({
			target: [schema.memberChannelState.memberId, schema.memberChannelState.channelId],
			set: { lastReadAt: now }
		})
	return { ok: true }
})
