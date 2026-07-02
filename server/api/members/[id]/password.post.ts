import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({ password: passwordSchema })

export default defineEventHandler(async (event) => {
	await requireAdmin(event)
	const id = getRouterParam(event, 'id')!
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	await db
		.update(schema.members)
		.set({ passwordHash: await hashPassword(body.password) })
		.where(eq(schema.members.id, id))
	return { ok: true }
})
