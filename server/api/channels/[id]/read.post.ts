export default defineEventHandler(async (event) => {
	const channelId = getRouterParam(event, 'id')!
	// verifies the channel exists (else FK-constraint 500) and gates DM access
	const { user } = await requireChannelMember(event, channelId)
	const db = useDb()
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
