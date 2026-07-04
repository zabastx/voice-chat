import { eq } from 'drizzle-orm'

// re-seals the session cookie with the member's current DB state. Called by
// the client after its own role changes (guards never trust the cookie role,
// so this only keeps the UI honest) and once on boot for pre-role cookies.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, user.id)
	})
	if (!member) {
		await clearUserSession(event)
		throw createError({ statusCode: 401, message: 'Аккаунт не найден' })
	}
	const fresh = { id: member.id, username: member.username, role: member.role }
	await setUserSession(event, { user: fresh })
	return fresh
})
