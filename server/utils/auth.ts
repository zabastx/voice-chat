import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'

const rank: Record<Role, number> = { member: 0, moderator: 1, admin: 2 }

// The session cookie proves identity; the DB row is the authority on role.
// Sealed cookies can't be revoked, so re-reading the role here makes
// promotion/demotion apply on the next request and cuts off privileged
// routes for deleted members whose cookie is still valid. See docs/adr/0002.
export async function requireRole(event: H3Event, min: 'moderator' | 'admin') {
	const { user } = await requireUserSession(event)
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, user.id)
	})
	if (!member || rank[member.role] < rank[min]) {
		throw createError({
			statusCode: 403,
			message: min === 'admin' ? 'Только для админа' : 'Недостаточно прав'
		})
	}
	return { id: member.id, username: member.username, role: member.role }
}
