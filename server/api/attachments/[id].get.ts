import { eq } from 'drizzle-orm'

export default defineEventHandler(async (event) => {
	await requireUserSession(event)
	const id = getRouterParam(event, 'id')!
	const attachment = await useDb().query.attachments.findFirst({
		where: eq(schema.attachments.id, id)
	})
	if (!attachment) {
		throw createError({ statusCode: 404, message: 'Файл не найден' })
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
		return sendRedirect(event, await presignGetUrl(objectKey), 302)
	}
	const res = await getObject(objectKey)
	if (!res.ok || !res.body) {
		throw createError({ statusCode: 502, message: 'Не удалось получить файл из хранилища' })
	}
	setHeader(event, 'content-type', usePreview ? 'image/webp' : attachment.mime)
	const length = res.headers.get('content-length')
	if (length) setHeader(event, 'content-length', Number(length))
	return res.body
})
