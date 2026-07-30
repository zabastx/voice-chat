export default defineEventHandler(async (event) => {
	const channelId = getRouterParam(event, 'id')!
	await requireWatchController(event, channelId)
	watchStop(channelId)
	return { ok: true }
})
