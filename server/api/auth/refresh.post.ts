import { eq } from 'drizzle-orm'

// re-seals the session cookie with the member's current DB state. Called by
// the client after its own role changes (guards never trust the cookie role,
// so this only keeps the UI honest) and once on boot for pre-role cookies.
//
// The session-member middleware skips /api/auth/*, so the Sign-in Epoch check
// has to happen here as well — without it this route would re-seal a revoked
// cookie under the *current* epoch and hand a signed-out device its access back.
export default defineEventHandler(async (event) => {
	const session = await requireUserSession(event)
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, session.user.id)
	})
	if (!member) {
		await clearUserSession(event)
		throw createError({ statusCode: 401, message: 'Аккаунт не найден' })
	}
	if (session.signInEpoch !== member.signInEpoch) {
		await clearUserSession(event)
		throw createError({ statusCode: 401, message: 'Сеанс завершён — войдите заново' })
	}
	// keep the member's own «запомнить меня» choice; re-issuing also rolls the
	// expiry forward, which is exactly right for a client that is demonstrably live
	return await issueSignIn(event, member, session.remembered === true)
})
