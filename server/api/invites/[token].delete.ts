import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireRole(event, 'moderator')
	const token = getRouterParam(event, 'token')!
	const db = useDb()
	const invite = await db.query.invites.findFirst({ where: eq(schema.invites.token, token) })
	if (!invite) {
		throw createError({ statusCode: 404, message: 'Приглашение не найдено' })
	}
	if (invite.usedAt) {
		throw createError({ statusCode: 400, message: 'Приглашение уже использовано' })
	}
	await db.delete(schema.invites).where(eq(schema.invites.token, token))
	return { ok: true }
})
