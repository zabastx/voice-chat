import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	const token = getRouterParam(event, 'token')!
	const invite = await useDb().query.invites.findFirst({
		where: eq(schema.invites.token, token)
	})
	return { valid: Boolean(invite && !invite.usedAt) }
})
