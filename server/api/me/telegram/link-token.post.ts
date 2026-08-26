// Mint a short-lived, single-use token for the `t.me/<bot>?start=<token>` deep
// link. The bot consumes it on `/start` and binds the sender's chat id.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const config = useRuntimeConfig()
	if (!telegramConfigured() || !config.public.telegramBotUsername) {
		throw createError({ statusCode: 503, message: 'Уведомления в Telegram не настроены' })
	}
	const token = await mintLinkToken(user.id, 'telegram')
	return { token, botUsername: config.public.telegramBotUsername }
})
