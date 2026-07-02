import { and, eq, inArray, isNull } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	content: z.string().max(4000),
	attachmentIds: z.array(z.string()).max(10).default([])
})

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const channelId = getRouterParam(event, 'id')!
	const body = await readValidatedBody(event, bodySchema.parse)
	const content = body.content.trim()
	if (!content && body.attachmentIds.length === 0) {
		throw createError({ statusCode: 400, message: 'Пустое сообщение' })
	}

	const db = useDb()
	const channel = await db.query.channels.findFirst({ where: eq(schema.channels.id, channelId) })
	if (!channel || channel.kind !== 'text') {
		throw createError({ statusCode: 404, message: 'Канал не найден' })
	}

	const message = {
		id: newId(),
		channelId,
		authorId: user.id,
		content,
		createdAt: new Date()
	}
	await db.insert(schema.messages).values(message)

	if (body.attachmentIds.length > 0) {
		// claim only this member's own unbound uploads; anything else is silently dropped
		await db
			.update(schema.attachments)
			.set({ messageId: message.id })
			.where(
				and(
					inArray(schema.attachments.id, body.attachmentIds),
					eq(schema.attachments.uploaderId, user.id),
					isNull(schema.attachments.messageId)
				)
			)
	}

	// the author has obviously read their own message
	await db
		.insert(schema.memberChannelState)
		.values({ memberId: user.id, channelId, lastReadAt: message.createdAt })
		.onConflictDoUpdate({
			target: [schema.memberChannelState.memberId, schema.memberChannelState.channelId],
			set: { lastReadAt: message.createdAt }
		})

	const dto = (await messageDto(message.id))!
	wsBroadcast({ type: 'message.created', message: dto })
	return dto
})
