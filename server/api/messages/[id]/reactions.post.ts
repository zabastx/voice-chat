import { and, eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({ emoji: z.string().trim().min(1).max(32) })

// Toggle the caller's reaction with `emoji` on a message, then rebroadcast the
// updated message so every client refreshes its reaction chips.
export default defineEventHandler(async (event) => {
	const id = getRouterParam(event, 'id')!
	const { emoji } = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()

	const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, id) })
	if (!message) {
		throw createError({ statusCode: 404, message: 'Сообщение не найдено' })
	}
	// reacting in a DM requires being a participant; no-op gate for text/voice
	const { channel, user } = await requireChannelMember(event, message.channelId)

	const mine = and(
		eq(schema.reactions.messageId, id),
		eq(schema.reactions.memberId, user.id),
		eq(schema.reactions.emoji, emoji)
	)
	const [existing] = await db.select().from(schema.reactions).where(mine).limit(1)
	if (existing) {
		await db.delete(schema.reactions).where(mine)
	} else {
		await db.insert(schema.reactions).values({ messageId: id, memberId: user.id, emoji })
	}

	const dto = (await messageDto(id))!
	await emitChannelEvent(channel, { type: 'message.updated', message: dto })
	return dto
})
