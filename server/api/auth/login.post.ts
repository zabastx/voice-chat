import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	username: z.string().trim().min(1),
	password: z.string().min(1)
})

export default defineEventHandler(async (event) => {
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()

	const member = await db.query.members.findFirst({
		where: eq(schema.members.username, body.username)
	})
	if (!member || !(await verifyPassword(member.passwordHash, body.password))) {
		throw createError({ statusCode: 401, message: 'Неверное имя пользователя или пароль' })
	}

	await setUserSession(event, {
		user: { id: member.id, username: member.username, isAdmin: member.isAdmin }
	})
	return { id: member.id, username: member.username, isAdmin: member.isAdmin }
})
