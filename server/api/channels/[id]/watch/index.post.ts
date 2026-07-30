import * as z from 'zod'

const bodySchema = z.object({
	// a raw pasted string; the server is the authority on what it means
	url: z.string().trim().min(1).max(2048)
})

export default defineEventHandler(async (event) => {
	const channelId = getRouterParam(event, 'id')!
	const { user } = await requireWatchController(event, channelId)

	const parsed = bodySchema.safeParse(await readBody(event))
	if (!parsed.success) {
		throw createError({ statusCode: 400, message: 'Введите ссылку на видео' })
	}

	const source = parseWatchUrl(parsed.data.url)
	if (!source) {
		throw createError({
			statusCode: 400,
			message: 'Не похоже на ссылку YouTube. Поддерживаются видео, Shorts и трансляции.'
		})
	}

	watchStart(channelId, user.id, source)
	return { ok: true }
})
