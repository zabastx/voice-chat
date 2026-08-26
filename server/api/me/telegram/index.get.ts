// The caller's own Telegram link status. The raw chat id and link token are
// secrets (never in memberDto / the session); memberDto carries only the derived
// `telegramNotifications` boolean. See adr/0006, and adr/0011 for the
// per-transport storage this reads from.
export default defineEventHandler(async (event) => {
	const { user } = await requireUserSession(event)
	const config = useRuntimeConfig()
	const link = await getLink(user.id, 'telegram')
	return {
		configured: telegramConfigured() && !!config.public.telegramBotUsername,
		linked: !!link?.externalId,
		// no row yet = never touched Telegram, and the default is on
		notificationsEnabled: link?.notificationsEnabled ?? true,
		botUsername: config.public.telegramBotUsername || null
	}
})
