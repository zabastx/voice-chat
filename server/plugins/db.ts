import { and, inArray, isNull, lt } from 'drizzle-orm'

const STALE_UPLOAD_AGE_MS = 24 * 60 * 60 * 1000

export default defineNitroPlugin(async () => {
	const db = await initDb()

	// sweep uploads that were never bound to a message (composer abandoned, tab closed)
	const stale = await db.query.attachments.findMany({
		where: and(
			isNull(schema.attachments.messageId),
			lt(schema.attachments.createdAt, new Date(Date.now() - STALE_UPLOAD_AGE_MS))
		)
	})
	if (stale.length > 0) {
		await deleteAttachmentObjects(stale.map((a) => a.objectKey))
		await db.delete(schema.attachments).where(
			inArray(
				schema.attachments.id,
				stale.map((a) => a.id)
			)
		)
	}
})
