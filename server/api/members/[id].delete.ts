import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const admin = await requireRole(event, 'admin')
	const id = getRouterParam(event, 'id')!
	if (id === admin.id) {
		throw createError({ statusCode: 400, message: 'Нельзя удалить самого себя' })
	}
	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	// cascades wipe this member's attachment rows (via uploader_id and via their
	// deleted messages) — collect object keys first so the files leave the bucket too
	const uploads = await db
		.select({ objectKey: schema.attachments.objectKey, previewKey: schema.attachments.previewKey })
		.from(schema.attachments)
		.where(eq(schema.attachments.uploaderId, id))
	await db.delete(schema.members).where(eq(schema.members.id, id))
	const keys = uploads.flatMap((a) => (a.previewKey ? [a.objectKey, a.previewKey] : [a.objectKey]))
	if (member.avatarId) keys.push(avatarObjectKey(member.id, member.avatarId))
	await deleteAttachmentObjects(keys)
	return { ok: true }
})
