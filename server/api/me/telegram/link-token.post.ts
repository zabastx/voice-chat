import { eq } from 'drizzle-orm'

const TOKEN_TTL_MS = 15 * 60 * 1000

// Mint a short-lived, single-use token for the `t.me/<bot>?start=<token>` deep
// link. The bot consumes it on `/start` and binds the sender's chat id.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const config = useRuntimeConfig()
	if (!telegramConfigured() || !config.public.telegramBotUsername) {
		throw createError({ statusCode: 503, message: 'Уведомления в Telegram не настроены' })
	}
	const token = newToken()
	await useDb()
		.update(schema.members)
		.set({
			telegramLinkToken: token,
			telegramLinkTokenExpiresAt: new Date(Date.now() + TOKEN_TTL_MS)
		})
		.where(eq(schema.members.id, user.id))
	return { token, botUsername: config.public.telegramBotUsername }
})
