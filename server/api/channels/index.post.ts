import { count } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	name: channelNameSchema,
	kind: z.enum(['text', 'voice'])
})

export default defineEventHandler(async (event) => {
	await requireAdmin(event)
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()
	const [row] = await db.select({ n: count() }).from(schema.channels)
	const channel = {
		id: newId(),
		name: body.name,
		kind: body.kind,
		position: row?.n ?? 0
	}
	await db.insert(schema.channels).values(channel)
	const dto: ChannelDto = { ...channel, lastMessageAt: null, lastReadAt: null }
	wsBroadcast({ type: 'channel.created', channel: dto })
	return dto
})
