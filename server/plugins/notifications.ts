import { lt } from 'drizzle-orm'

// how long a delivered notification stays repliable before its mapping row is
// swept; a reply to an older notification falls through to the "too old" hint
const MAPPING_TTL_MS = 7 * 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

async function sweepNotificationMappings() {
	await useDb()
		.delete(schema.notificationMappings)
		.where(lt(schema.notificationMappings.createdAt, new Date(Date.now() - MAPPING_TTL_MS)))
}

export default defineNitroPlugin(async () => {
	// Register the transports before any message can be sent. Each decides for
	// itself whether it is configured; an unconfigured one stays inert.
	registerTelegramTransport()

	// Webhook registration lives in the telegram-relay service; the main app owns
	// the reply-mapping table. Ensure the DB is ready first — this plugin can run
	// before plugins/db.ts, and initDb() is memoised so it's a no-op once
	// initialised. Then sweep at boot and hourly, matching the stale-upload sweep.
	await initDb()
	sweepNotificationMappings().catch((err) => console.error('notification sweep failed', err))
	setInterval(() => {
		sweepNotificationMappings().catch((err) => console.error('notification sweep failed', err))
	}, SWEEP_INTERVAL_MS)
})
