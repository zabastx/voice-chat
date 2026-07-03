import { eq } from 'drizzle-orm'
import * as z from 'zod'

const bodySchema = z.object({
	displayName: displayNameSchema.nullable()
})

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const body = await readValidatedBody(event, bodySchema.parse)
	const db = useDb()
	const [member] = await db
		.update(schema.members)
		.set({ displayName: body.displayName })
		.where(eq(schema.members.id, user.id))
		.returning()
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	const dto = memberDto(member)
	wsBroadcast({ type: 'member.updated', member: dto })
	return dto
})
