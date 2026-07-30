import * as z from 'zod'

const bodySchema = z.object({
	paused: z.boolean(),
	// finite guard: NaN/Infinity from a confused player would poison the anchor
	positionSec: z
		.number()
		.finite()
		.min(0)
		.max(24 * 3600),
	// YouTube offers 0.25–2; the bound is a sanity guard, not a whitelist, since
	// the set of available rates varies per video. Absent means "unchanged".
	rate: z.number().finite().min(0.25).max(4).optional()
})

export default defineEventHandler(async (event) => {
	const channelId = getRouterParam(event, 'id')!
	const { user } = await requireWatchController(event, channelId)

	const parsed = bodySchema.safeParse(await readBody(event))
	if (!parsed.success) {
		throw createError({ statusCode: 400, message: 'Некорректное состояние воспроизведения' })
	}

	// 404 rather than a silent no-op: the session was stopped or replaced out
	// from under this client, and it needs to know its command went nowhere
	if (!watchSetState(channelId, user.id, parsed.data)) {
		throw createError({ statusCode: 404, message: 'Совместный просмотр не запущен' })
	}
	return { ok: true }
})
