import { eq } from 'drizzle-orm'

// Sessions are stateless sealed cookies, so deleting a member does not revoke
// their session — without this check a deleted member keeps reading messages,
// downloading attachments and minting LiveKit tokens until the cookie expires.
// Clearing the session here is not enough: the handler's requireUserSession()
// in the same request still sees the already-unsealed cookie, so reject
// explicitly. Routes that must work with a stale cookie are skipped: all of
// /api/auth/* plus the public invite-validity check, so a deleted member can
// re-register with a fresh invite.
function isPublic(event: { path: string; method: string }) {
	const path = event.path.split('?')[0]!
	if (!path.startsWith('/api/')) return true
	if (path.startsWith('/api/auth/')) return true
	if (event.method === 'GET' && /^\/api\/invites\/[^/]+$/.test(path)) return true
	return false
}

export default defineEventHandler(async (event) => {
	if (isPublic(event)) return
	const session = await getUserSession(event)
	if (!session.user) return
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, session.user.id),
		columns: { id: true }
	})
	if (!member) {
		await clearUserSession(event)
		throw createError({ statusCode: 401, message: 'Сеанс недействителен — войдите заново' })
	}
})
