import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireAdmin(event)
	const id = getRouterParam(event, 'id')!
	const db = useDb()
	const channel = await db.query.channels.findFirst({ where: eq(schema.channels.id, id) })
	if (!channel) {
		throw createError({ statusCode: 404, message: 'Канал не найден' })
	}
	// the FK cascade wipes the attachment rows with the messages — collect the
	// object keys first or the files stay in the bucket forever
	const orphans = await db
		.select({ objectKey: schema.attachments.objectKey, previewKey: schema.attachments.previewKey })
		.from(schema.attachments)
		.innerJoin(schema.messages, eq(schema.attachments.messageId, schema.messages.id))
		.where(eq(schema.messages.channelId, id))
	await db.delete(schema.channels).where(eq(schema.channels.id, id))
	await deleteAttachmentObjects(
		orphans.flatMap((a) => (a.previewKey ? [a.objectKey, a.previewKey] : [a.objectKey]))
	)
	wsBroadcast({ type: 'channel.deleted', channelId: id })
	return { ok: true }
})
