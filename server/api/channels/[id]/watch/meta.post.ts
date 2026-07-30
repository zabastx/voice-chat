import * as z from 'zod'

const bodySchema = z.object({
	// the video this report describes; a report for an already-replaced video
	// is dropped rather than applied to its successor
	ref: z.string().min(1).max(64),
	live: z.boolean().optional(),
	title: z.string().max(200).nullable().optional()
})

/**
 * Facts only a loaded player knows — whether the source is a live broadcast,
 * and its title. Reported by clients, not a control action: it never
 * re-anchors playback and carries no actor, so it can't be mistaken for a seek.
 */
export default defineEventHandler(async (event) => {
	const channelId = getRouterParam(event, 'id')!
	await requireWatchController(event, channelId)

	const parsed = bodySchema.safeParse(await readBody(event))
	if (!parsed.success) throw createError({ statusCode: 400, message: 'Некорректные данные' })

	const { ref, ...meta } = parsed.data
	watchReportMetadata(channelId, ref, meta)
	return { ok: true }
})
