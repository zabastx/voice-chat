import { eq } from 'drizzle-orm'

// The caller's own Telegram link status. The raw chat id and link token are
// secrets (never in memberDto / the session); memberDto carries only the derived
// `telegramNotifications` boolean. See adr/0006.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const config = useRuntimeConfig()
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, user.id)
	})
	if (!member) {
		throw createError({ statusCode: 404, message: 'Участник не найден' })
	}
	return {
		configured: telegramConfigured() && !!config.public.telegramBotUsername,
		linked: !!member.telegramChatId,
		notificationsEnabled: member.telegramNotificationsEnabled,
		botUsername: config.public.telegramBotUsername || null
	}
})
