import { eq } from 'drizzle-orm'

// mime types browsers render inline that we actually want inline; anything
// else (text/html, application/pdf, …) is forced to download so an uploaded
// file can never execute as a page — neither on the bucket origin nor,
// via ?proxy, on the app origin with session cookies.
function isInlineSafe(mime: string) {
	return /^(image|video|audio)\//.test(mime)
}

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const id = getRouterParam(event, 'id')!
	const db = useDb()
	const attachment = await db.query.attachments.findFirst({
		where: eq(schema.attachments.id, id)
	})
	if (!attachment) {
		throw createError({ statusCode: 404, message: 'Файл не найден' })
	}
	// an attachment bound to a DM message is only fetchable by that DM's
	// participants — attachment ids are unguessable, but access must still be gated
	if (attachment.messageId) {
		const message = await db.query.messages.findFirst({
			where: eq(schema.messages.id, attachment.messageId)
		})
		if (message) await requireChannelMember(event, message.channelId)
	}
	const query = getQuery(event)
	// `?preview` serves the downscaled WebP for in-chat display; falls back to the
	// original when there's no preview (non-image / older upload), so it's always safe.
	const usePreview = query.preview !== undefined && attachment.previewKey
	const objectKey = usePreview ? attachment.previewKey! : attachment.objectKey
	// Default: 302 to a presigned S3 URL — cheap, offloads bandwidth, and works
	// for <img>/<video>/<audio> which render cross-origin media opaquely.
	// `?proxy`: stream the bytes through the app instead, for clients that read
	// the body in JS (voice-message waveform decoder). Following the redirect and
	// reading it cross-origin needs CORS headers the bucket doesn't send.
	if (query.proxy === undefined) {
		// let the browser reuse the redirect target while the presign is valid
		// instead of re-signing on every re-render (presign lives 300s)
		setHeader(event, 'cache-control', 'private, max-age=240')
		return sendRedirect(
			event,
			await presignGetUrl(objectKey, {
				downloadAs: isInlineSafe(attachment.mime) ? undefined : attachment.filename
			}),
			302
		)
	}
	const res = await getObject(objectKey)
	if (!res.ok || !res.body) {
		throw createError({ statusCode: 502, message: 'Не удалось получить файл из хранилища' })
	}
	setHeader(event, 'content-type', usePreview ? 'image/webp' : attachment.mime)
	setHeader(event, 'x-content-type-options', 'nosniff')
	// proxied bytes are only ever consumed via fetch(); a direct navigation must
	// download, not render, since this response carries the app origin
	setHeader(event, 'content-disposition', 'attachment')
	const length = res.headers.get('content-length')
	if (length) setHeader(event, 'content-length', Number(length))
	return res.body
})
