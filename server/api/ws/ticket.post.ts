export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	return { ticket: createWsTicket({ memberId: user.id, username: user.username }) }
})
