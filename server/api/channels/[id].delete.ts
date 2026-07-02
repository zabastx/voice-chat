import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireAdmin(event)
	const id = getRouterParam(event, 'id')!
	const db = useDb()
	const channel = await db.query.channels.findFirst({ where: eq(schema.channels.id, id) })
	if (!channel) {
		throw createError({ statusCode: 404, message: 'Канал не найден' })
	}
	await db.delete(schema.channels).where(eq(schema.channels.id, id))
	wsBroadcast({ type: 'channel.deleted', channelId: id })
	return { ok: true }
})
