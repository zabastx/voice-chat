// Disconnect one messenger. Leaves the notifications toggle as-is so re-linking
// later restores the member's previous preference.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const transport = requireTransport(event)
	await clearLink(user.id, transport)
	return { ok: true }
})
