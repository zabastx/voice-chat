// Disconnect the caller's Telegram account. Leaves the notifications toggle as-is
// so re-linking later restores the member's previous preference.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	await clearTelegramLink(user.id)
	return { ok: true }
})
