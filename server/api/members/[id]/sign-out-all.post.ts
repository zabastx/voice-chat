import { eq } from 'drizzle-orm'

// Admin cutoff: end every Sign-in a member holds without deleting them or
// touching their password. The lever for "they left the group" or "their laptop
// was stolen" — until this existed, a sealed cookie outlived every remedy short
// of deleting the account (docs/adr/0012).
export default defineEventHandler(async (event) => {
	await requireRole(event, 'admin')
	const id = getRouterParam(event, 'id')!
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, id),
		columns: { id: true }
	})
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	await bumpSignInEpoch(id)
	return { ok: true }
})
