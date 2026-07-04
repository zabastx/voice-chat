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
	// Default: 302 to a presigned S3 URL — cheap, offloads bandwidth, and works
	// for <img>/<video>/<audio> which render cross-origin media opaquely.
	// `?proxy`: stream the bytes through the app instead, for clients that read
	// the body in JS (voice-message waveform decoder). Following the redirect and
	// reading it cross-origin needs CORS headers the bucket doesn't send.
	if (getQuery(event).proxy === undefined) {
		return sendRedirect(event, await presignGetUrl(attachment.objectKey), 302)
	}
	const res = await getObject(attachment.objectKey)
	if (!res.ok || !res.body) {
		throw createError({ statusCode: 502, message: 'Не удалось получить файл из хранилища' })
	}
	setHeader(event, 'content-type', attachment.mime)
	const length = res.headers.get('content-length')
	if (length) setHeader(event, 'content-length', Number(length))
	return res.body
})
