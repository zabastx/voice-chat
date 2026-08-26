// Mint a short-lived single-use token and hand back the complete deep link.
// The client only opens the URL — how a messenger carries the token back
// (Telegram's /start payload, VK's ?ref=) stays server-side.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const transport = requireTransport(event)
	const info = transportInfo(transport)
	if (!info.configured) {
		throw createError({ statusCode: 503, message: `Уведомления в ${info.label} не настроены` })
	}
	const token = await mintLinkToken(user.id, transport)
	const url = info.deepLink(token)
	if (!url) {
		throw createError({ statusCode: 503, message: `Уведомления в ${info.label} не настроены` })
	}
	return { url }
})
