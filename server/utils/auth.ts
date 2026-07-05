import { and, eq } from 'drizzle-orm'
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
	// an unrecognised role (e.g. bad data) must fail closed: `rank[x] < rank[min]`
	// is `undefined < n` → false, which would wrongly PASS the guard, so floor it to -1
	if (!member || (rank[member.role] ?? -1) < rank[min]) {
		throw createError({
			statusCode: 403,
			message: min === 'admin' ? 'Только для админа' : 'Недостаточно прав'
		})
	}
	return { id: member.id, username: member.username, role: member.role }
}

// The single access chokepoint for reading/writing a channel's messages. Text
// and voice channels are open to every member (single flat server), so this is a
// no-op for them. A DM channel is private: the caller must be a participant, and
// a non-member gets 404 — not 403 — so the endpoint never reveals that a DM even
// exists. Returns the channel row so callers can branch on kind.
export async function requireChannelMember(event: H3Event, channelId: string) {
	const { user } = await requireUserSession(event)
	const db = useDb()
	const channel = await db.query.channels.findFirst({
		where: eq(schema.channels.id, channelId)
	})
	if (!channel) {
		throw createError({ statusCode: 404, message: 'Канал не найден' })
	}
	if (channel.kind === 'dm') {
		const participant = await db.query.channelParticipants.findFirst({
			where: and(
				eq(schema.channelParticipants.channelId, channelId),
				eq(schema.channelParticipants.memberId, user.id)
			)
		})
		if (!participant) {
			throw createError({ statusCode: 404, message: 'Канал не найден' })
		}
	}
	return { channel, user }
}
