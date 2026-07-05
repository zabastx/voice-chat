import { lt } from 'drizzle-orm'

// how long a delivered notification stays repliable before its mapping row is
// swept; a reply to an older notification falls through to the "too old" hint
const MAPPING_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function sweepNotificationMappings() {
	await useDb()
		.delete(schema.telegramNotifications)
		.where(lt(schema.telegramNotifications.createdAt, new Date(Date.now() - MAPPING_TTL_MS)))
}

export default defineNitroPlugin(async () => {
	const config = useRuntimeConfig()
	if (!config.telegramBotToken) return // feature disabled — nothing to set up

	// register the webhook so Telegram delivers linking `/start`s and replies.
	// Needs a public HTTPS URL; in local dev without a tunnel we skip and log.
	if (config.telegramWebhookUrl && config.telegramWebhookSecret) {
		const ok = await tgApi('setWebhook', {
			url: config.telegramWebhookUrl,
			secret_token: config.telegramWebhookSecret,
			allowed_updates: ['message']
		})
		if (ok) console.log('[voice-chat] telegram webhook registered')
	} else {
		console.warn(
			'[voice-chat] telegram bot token set but NUXT_TELEGRAM_WEBHOOK_URL/SECRET missing — ' +
				'inbound updates (linking, replies) are disabled. See docs/GOTCHAS.md.'
		)
	}

	// at boot and then hourly, matching the stale-upload sweep in plugins/db.ts
	await sweepNotificationMappings().catch((err) =>
		console.error('telegram mapping sweep failed', err)
	)
	setInterval(() => {
		sweepNotificationMappings().catch((err) => console.error('telegram mapping sweep failed', err))
	}, SWEEP_INTERVAL_MS)
})
