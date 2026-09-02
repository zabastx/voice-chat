import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	username: z.string().trim().min(1),
	password: z.string().min(1),
	// «запомнить меня», ticked by default in the form. Unticked, the cookie gets
	// no expiry and dies with the browser — see issueSignIn.
	remember: z.boolean().default(true)
})

export default defineEventHandler(async (event) => {
	requireRateLimit(event, 'login', 10, 15 * 60 * 1000)
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()

	const member = await db.query.members.findFirst({
		where: eq(schema.members.username, body.username)
	})
	if (!member || !(await verifyPassword(member.passwordHash, body.password))) {
		throw createError({ statusCode: 401, message: 'Неверное имя пользователя или пароль' })
	}

	return await issueSignIn(event, member, body.remember)
})
