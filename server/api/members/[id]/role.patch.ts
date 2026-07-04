import { eq } from 'drizzle-orm'
import * as z from 'zod'

// the admin role itself is never assignable or removable
const bodySchema = z.object({ role: z.enum(['moderator', 'member']) })

export default defineEventHandler(async (event) => {
	await requireRole(event, 'admin')
	const id = getRouterParam(event, 'id')!
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	if (member.role === 'admin') {
		throw createError({ statusCode: 400, message: 'Нельзя изменить роль админа' })
	}
	await db.update(schema.members).set({ role: body.role }).where(eq(schema.members.id, id))
	const dto = memberDto({ ...member, role: body.role })
	// the target's client sees its own id in this event and refreshes its session
	wsBroadcast({ type: 'member.updated', member: dto })
	return dto
})
