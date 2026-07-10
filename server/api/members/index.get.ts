import { asc } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const rows = await useDb()
		.select({
			id: schema.members.id,
			username: schema.members.username,
			displayName: schema.members.displayName,
			avatarId: schema.members.avatarId,
			role: schema.members.role,
			createdAt: schema.members.createdAt,
			telegramChatId: schema.members.telegramChatId,
			telegramNotificationsEnabled: schema.members.telegramNotificationsEnabled
		})
		.from(schema.members)
		.orderBy(asc(schema.members.createdAt))
	return rows.map(memberDto)
})
