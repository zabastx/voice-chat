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

export default defineNitroPlugin(() => {
	// Webhook registration now lives in the telegram-relay service; the main app
	// only owns the reply-mapping table. Sweep it at boot and then hourly, matching
	// the stale-upload sweep in plugins/db.ts.
	sweepNotificationMappings().catch((err) => console.error('telegram mapping sweep failed', err))
	setInterval(() => {
		sweepNotificationMappings().catch((err) => console.error('telegram mapping sweep failed', err))
	}, SWEEP_INTERVAL_MS)
})
