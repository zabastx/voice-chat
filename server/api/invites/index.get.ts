import { desc, eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireRole(event, 'moderator')
	const db = useDb()
	const rows = await db
		.select({
			token: schema.invites.token,
			createdAt: schema.invites.createdAt,
			usedAt: schema.invites.usedAt,
			usedByName: schema.members.username
		})
		.from(schema.invites)
		.leftJoin(schema.members, eq(schema.invites.usedBy, schema.members.id))
		.orderBy(desc(schema.invites.createdAt))
	return rows
})
