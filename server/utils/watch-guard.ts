import type { H3Event } from 'h3'

/**
 * Every Watch Session command is authorized by presence, not by role: the
 * Audience is exactly the Voice Channel roster, and anyone in it may drive
 * playback (adr/0009). Resolving the room from the caller's own presence —
 * rather than from the `:id` they sent — means a client cannot act on a room
 * it isn't in, because the room it names is never the one that's used.
 */
export async function requireWatchController(event: H3Event, channelId: string) {
	const { user } = await requireUserSession(event)
	const connectedTo = voiceChannelOf(user.id)
	if (!connectedTo || connectedTo !== channelId) {
		throw createError({
			statusCode: 403,
			message: 'Сначала подключитесь к голосовому каналу'
		})
	}
	return { user, channelId: connectedTo }
}
