import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const id = getRouterParam(event, 'id')!
	const db = useDb()

	const message = await db.query.messages.findFirst({ where: eq(schema.messages.id, id) })
	if (!message) {
		throw createError({ statusCode: 404, message: 'Сообщение не найдено' })
	}
	if (message.authorId !== user.id) {
		// deleting someone else's message is an admin power — check the DB
		// role, not the cookie, so demotion applies immediately
		const member = await db.query.members.findFirst({ where: eq(schema.members.id, user.id) })
		if (member?.role !== 'admin') {
			throw createError({ statusCode: 403, message: 'Это не ваше сообщение' })
		}
	}

	const attachments = await db.query.attachments.findMany({
		where: eq(schema.attachments.messageId, id)
	})
	await db.delete(schema.messages).where(eq(schema.messages.id, id))
	if (attachments.length > 0) {
		await deleteAttachmentObjects(
			attachments.flatMap((a) => (a.previewKey ? [a.objectKey, a.previewKey] : [a.objectKey]))
		)
	}

	wsBroadcast({ type: 'message.deleted', channelId: message.channelId, messageId: id })

	// replies to this message now dangle — rebroadcast them so their quote
	// flips to "исходное сообщение удалено" live
	const replies = await db
		.select({ id: schema.messages.id })
		.from(schema.messages)
		.where(eq(schema.messages.replyToId, id))
	for (const reply of replies) {
		const dto = await messageDto(reply.id)
		if (dto) wsBroadcast({ type: 'message.updated', message: dto })
	}

	return { ok: true }
})
