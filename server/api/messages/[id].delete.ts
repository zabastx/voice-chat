import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const id = getRouterParam(event, 'id')!
	const db = useDb()

	const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, id) })
	if (!message) {
		throw createError({ statusCode: 404, message: 'Сообщение не найдено' })
	}
	if (message.authorId !== user.id && !user.isAdmin) {
		throw createError({ statusCode: 403, message: 'Это не ваше сообщение' })
	}

	const attachments = await db.query.attachments.findMany({
		where: eq(schema.attachments.messageId, id)
	})
	await db.delete(schema.messages).where(eq(schema.messages.id, id))
	if (attachments.length > 0) {
		await deleteAttachmentObjects(attachments.map((a) => a.objectKey))
	}

	wsBroadcast({ type: 'message.deleted', channelId: message.channelId, messageId: id })
	return { ok: true }
})
