import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const id = getRouterParam(event, 'id')!
	const member = await useDb().query.members.findFirst({ where: eq(schema.members.id, id) })
	if (!member?.avatarId) {
		throw createError({ statusCode: 404, message: 'Аватар не найден' })
	}
	// the URL carries ?v=avatarId as a cache key, so caching the redirect is safe;
	// avatars render on every message row — don't re-sign per <img>
	setHeader(event, 'cache-control', 'private, max-age=240')
	return sendRedirect(event, await presignGetUrl(avatarObjectKey(member.id, member.avatarId)), 302)
})
