import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	currentPassword: z.string().min(1, 'Введите текущий пароль'),
	newPassword: passwordSchema
})

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, user.id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	if (!(await verifyPassword(member.passwordHash, body.currentPassword))) {
		throw createError({ statusCode: 400, message: 'Неверный текущий пароль' })
	}
	await db
		.update(schema.members)
		.set({ passwordHash: await hashPassword(body.newPassword) })
		.where(eq(schema.members.id, user.id))
	return { ok: true }
})
