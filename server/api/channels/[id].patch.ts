import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({ name: channelNameSchema })

export default defineEventHandler(async (event) => {
	await requireRole(event, 'moderator')
	const id = getRouterParam(event, 'id')!
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()
	const channel = await db.query.channels.findFirst({ where: eq(schema.channels.id, id) })
	if (!channel || channel.kind === 'dm') {
		// DM channels have no name and aren't managed through the channel routes
		throw createError({ statusCode: 404, message: 'Канал не найден' })
	}
	await db.update(schema.channels).set({ name: body.name }).where(eq(schema.channels.id, id))
	const dto: ChannelDto = {
		id: channel.id,
		name: body.name,
		kind: channel.kind,
		position: channel.position,
		lastMessageAt: null,
		lastReadAt: null
	}
	wsBroadcast({ type: 'channel.updated', channel: dto })
	return dto
})
