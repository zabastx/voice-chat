import { and, inArray, isNull, lt } from 'drizzle-orm'

const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 60 * 1000

// sweep uploads that were never bound to a message (composer abandoned, tab closed)
async function sweepStaleUploads(db: Db) {
	const stale = await db.query.attachments.findMany({
		where: and(
			isNull(schema.attachments.messageId),
			lt(schema.attachments.createdAt, new Date(Date.now() - STALE_UPLOAD_AGE_MS))
		)
	})
	if (stale.length === 0) return
	await deleteAttachmentObjects(
		stale.flatMap((a) => (a.previewKey ? [a.objectKey, a.previewKey] : [a.objectKey]))
	)
	await db.delete(schema.attachments).where(
		inArray(
			schema.attachments.id,
			stale.map((a) => a.id)
		)
	)
}

export default defineNitroPlugin(async () => {
	const db = await initDb()

	const config = useRuntimeConfig()
	if (!import.meta.dev && config.livekitApiSecret.startsWith('devsecret')) {
		console.warn(
			'[voice-chat] NUXT_LIVEKIT_API_SECRET is not set — running production with the ' +
				'public dev secret. LiveKit webhooks are spoofable; set a real secret in .env.'
		)
	}

	// at boot and then hourly — a server that stays up for months would
	// otherwise never sweep abandoned uploads again
	await sweepStaleUploads(db)
	setInterval(() => {
		sweepStaleUploads(db).catch((err) => console.error('stale upload sweep failed', err))
	}, SWEEP_INTERVAL_MS)
})
