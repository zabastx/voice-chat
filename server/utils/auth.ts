import { and, eq, sql } from 'drizzle-orm'
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

// How long a remembered Sign-in survives without use. 400 days is the Chrome and
// Safari Max-Age clamp, so it is the honest ceiling on «бессрочно».
export const SIGN_IN_MAX_AGE_MS = 400 * 24 * 60 * 60 * 1000

// A remembered Sign-in is re-issued once it passes this age, which pushes the
// expiry above back out. Renewing on *every* request would put a Set-Cookie on
// every response for no gain, so age is checked against a threshold instead.
export const SIGN_IN_RENEWAL_MS = 7 * 24 * 60 * 60 * 1000

// Seals a Sign-in for `member`. `remembered` decides how long the browser keeps
// the cookie: ticked, it gets an explicit expiry SIGN_IN_MAX_AGE_MS from now;
// unticked, `maxAge: 0` suppresses the expiry attribute entirely and the browser
// drops the cookie when it closes — the pre-v0.23.0 behaviour, kept as the opt-out.
//
// The expiry is passed as `cookie.expires` rather than left to h3, and that is
// what makes the window ROLL. h3 would otherwise write
// `session.createdAt + maxAge`, and createdAt is pinned to the first cookie the
// browser ever got: re-sealing (even via replaceUserSession) restores it from the
// request cookie, so every "renewal" rewrote the same date and an active member
// would still have been logged out 400 days after their first login. h3 spreads
// `config.cookie` last, so ours wins. See GOTCHAS #24 and docs/adr/0012.
export async function issueSignIn(
	event: H3Event,
	member: { id: string; username: string; role: Role; signInEpoch: number },
	remembered: boolean
) {
	const user = { id: member.id, username: member.username, role: member.role }
	await replaceUserSession(
		event,
		{ user, signInEpoch: member.signInEpoch, remembered, issuedAt: Date.now() },
		remembered ? { cookie: { expires: new Date(Date.now() + SIGN_IN_MAX_AGE_MS) } } : { maxAge: 0 }
	)
	return user
}

// Ends every Sign-in this member holds, everywhere. The HTTP side is the epoch
// itself — the session-member middleware compares it on the next request — but an
// open WebSocket was authed once at connect and would otherwise keep streaming
// messages to a revoked device, so its sockets are closed here too.
export async function bumpSignInEpoch(memberId: string) {
	const [row] = await useDb()
		.update(schema.members)
		.set({ signInEpoch: sql`${schema.members.signInEpoch} + 1` })
		.where(eq(schema.members.id, memberId))
		.returning({ signInEpoch: schema.members.signInEpoch })
	// No row means the member vanished between the caller's read and this write.
	// Fail loudly: callers that re-issue their own Sign-in would otherwise seal a
	// cookie at a fabricated epoch, which for a member still sitting at 0 would be
	// a VALID one — a revocation that silently revoked nothing.
	if (!row) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	wsDisconnectMember(memberId)
	return row.signInEpoch
}
