export default defineEventHandler(async (event) => {
	const user = await requireRole(event, 'moderator')
	const invite = { token: newToken(), createdBy: user.id }
	await useDb().insert(schema.invites).values(invite)
	return { token: invite.token }
})
