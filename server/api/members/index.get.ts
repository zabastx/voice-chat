import { asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const rows = await useDb()
		.select({
			id: schema.members.id,
			username: schema.members.username,
			displayName: schema.members.displayName,
			avatarId: schema.members.avatarId,
			isAdmin: schema.members.isAdmin,
			createdAt: schema.members.createdAt
		})
		.from(schema.members)
		.orderBy(asc(schema.members.createdAt))
	return rows.map(memberDto)
})
