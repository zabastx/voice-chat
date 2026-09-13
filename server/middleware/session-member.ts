import { eq } from 'drizzle-orm'

// Sessions are stateless sealed cookies, so neither deleting a member nor
// revoking their access can recall one — without this check a deleted member
// keeps reading messages, downloading attachments and minting LiveKit tokens
// until the cookie expires. Two things are enforced here, on the one member row
// this already had to read:
//
//   * the member still exists, and
//   * the cookie's Sign-in Epoch still matches theirs (docs/adr/0012) — a
//     «выйти со всех устройств», a password change or an admin cutoff moves the
//     epoch on, and every cookie sealed under the old one dies on its next
//     request.
//
// Clearing the session here is not enough: the handler's requireUserSession()
// in the same request still sees the already-unsealed cookie, so reject
// explicitly. Routes that must work with a stale cookie are skipped: all of
// /api/auth/* plus the public invite-validity check, so a deleted member can
// re-register with a fresh invite. /api/auth/refresh re-seals a session and so
// runs the same epoch check itself. The Desktop Update feed and the Desktop
// Download are skipped for a different reason: they have no member at all. The
// Desktop Client checks the feed before the remote Web Release — and therefore
// any session — has loaded (adr/0014), and the Download is offered on the login
// page, so neither must ever be able to fail on one.
function isPublic(event: { path: string; method: string }) {
	const path = event.path.split('?')[0]!
	if (!path.startsWith('/api/')) return true
	if (path.startsWith('/api/auth/')) return true
	if (path.startsWith('/api/desktop/')) return true
	if (event.method === 'GET' && /^\/api\/invites\/[^/]+$/.test(path)) return true
	return false
}

export default defineEventHandler(async (event) => {
	if (isPublic(event)) return
	const session = await getUserSession(event)
	if (!session.user) return
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, session.user.id),
		columns: { id: true, username: true, role: true, signInEpoch: true }
	})
	if (!member) {
		await clearUserSession(event)
		throw createError({ statusCode: 401, message: 'Сеанс недействителен — войдите заново' })
	}
	// A cookie predating docs/adr/0012 carries no epoch at all. Treating that as
	// "matches" would leave those cookies permanently unrevocable, so it counts as
	// a mismatch: everyone signs in once more after the deploy.
	if (session.signInEpoch !== member.signInEpoch) {
		await clearUserSession(event)
		throw createError({ statusCode: 401, message: 'Сеанс завершён — войдите заново' })
	}
	// Roll a remembered Sign-in forward so an active member is never logged out.
	// Only a remembered one: renewing the opt-out branch would write the expiry
	// the member declined and quietly make it persistent.
	if (session.remembered && Date.now() - (session.issuedAt ?? 0) > SIGN_IN_RENEWAL_MS) {
		await issueSignIn(event, member, true)
	}
})
