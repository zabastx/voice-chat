export default defineEventHandler(async (event) => {
	const admin = await requireAdmin(event)
	const invite = { token: newToken(), createdBy: admin.id }
	await useDb().insert(schema.invites).values(invite)
	return { token: invite.token }
})
