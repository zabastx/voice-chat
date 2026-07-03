import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const admin = await requireAdmin(event)
	const id = getRouterParam(event, 'id')!
	if (id === admin.id) {
		throw createError({ statusCode: 400, message: 'Нельзя удалить самого себя' })
	}
	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	await db.delete(schema.members).where(eq(schema.members.id, id))
	if (member.avatarId) {
		await deleteAttachmentObjects([avatarObjectKey(member.id, member.avatarId)])
	}
	return { ok: true }
})
