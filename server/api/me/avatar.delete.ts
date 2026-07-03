import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const db = useDb()
	const member = await db.query.members.findFirst({ where: eq(schema.members.id, user.id) })
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}

	const [updated] = await db
		.update(schema.members)
		.set({ avatarId: null })
		.where(eq(schema.members.id, user.id))
		.returning()

	if (member.avatarId) {
		await deleteAttachmentObjects([avatarObjectKey(user.id, member.avatarId)])
	}

	const dto = memberDto(updated!)
	wsBroadcast({ type: 'member.updated', member: dto })
	return dto
})
