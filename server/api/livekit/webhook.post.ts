import { TrackSource, WebhookReceiver } from 'livekit-server-sdk'

let receiver: WebhookReceiver | undefined

export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig()
	receiver ??= new WebhookReceiver(config.livekitApiKey, config.livekitApiSecret)

	const body = await readRawBody(event)
	const auth = getHeader(event, 'authorization')
	if (!body || !auth) {
		throw createError({ statusCode: 401, statusMessage: 'Unauthenticated webhook' })
	}

	let hook
	try {
		hook = await receiver.receive(body, auth)
	} catch {
		throw createError({ statusCode: 401, statusMessage: 'Invalid webhook signature' })
	}

	const channelId = hook.room?.name
	const identity = hook.participant?.identity
	switch (hook.event) {
		case 'participant_joined':
			if (channelId && identity) {
				voiceParticipantJoined(channelId, identity, hook.participant?.name || identity)
			}
			break
		case 'participant_left':
			if (channelId && identity) voiceParticipantLeft(channelId, identity)
			break
		case 'track_published':
			if (channelId && identity && hook.track?.source === TrackSource.SCREEN_SHARE) {
				voiceSetScreenShare(channelId, identity, true)
			}
			break
		case 'track_unpublished':
			if (channelId && identity && hook.track?.source === TrackSource.SCREEN_SHARE) {
				voiceSetScreenShare(channelId, identity, false)
			}
			break
		case 'room_finished':
			if (channelId) voiceRoomFinished(channelId)
			break
	}
	return { ok: true }
})
