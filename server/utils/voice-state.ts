// In-memory Voice State: which members are in which voice channel.
// Written by LiveKit webhooks (join/leave/screenshare) and the WS hub (mute),
// read by everyone through the WS snapshot + voice.state broadcasts.

const rooms = new Map<string, Map<string, VoiceParticipant>>()

export function voiceRooms(): VoiceRooms {
	const out: VoiceRooms = {}
	for (const [channelId, participants] of rooms) {
		if (participants.size > 0) out[channelId] = [...participants.values()]
	}
	return out
}

function broadcastVoice() {
	wsBroadcast({ type: 'voice.state', voice: voiceRooms() })
}

/**
 * Which Voice Channel a member is currently connected to, if any. Lets an
 * endpoint act on the room the caller is actually in rather than on a
 * client-supplied channel id — the same authorization-by-construction that
 * `voiceSetMutedByMember` gets by taking no channel id at all (adr/0009).
 */
export function voiceChannelOf(memberId: string): string | undefined {
	for (const [channelId, participants] of rooms) {
		if (participants.has(memberId)) return channelId
	}
	return undefined
}

export function voiceParticipantJoined(channelId: string, memberId: string, username: string) {
	// Switching channels emits participant_left(old) and participant_joined(new)
	// as two independent webhooks with no ordering guarantee. If the join lands
	// first the member would sit in two rooms at once, and voiceChannelOf would
	// return whichever the map iterated first — so drop any stale membership.
	for (const [otherId, participants] of rooms) {
		if (otherId !== channelId && participants.delete(memberId) && participants.size === 0) {
			rooms.delete(otherId)
		}
	}
	let participants = rooms.get(channelId)
	if (!participants) {
		participants = new Map()
		rooms.set(channelId, participants)
	}
	participants.set(memberId, {
		memberId,
		username,
		muted: false,
		speaking: false,
		screenSharing: false,
		cameraOn: false
	})
	broadcastVoice()
}

export function voiceParticipantLeft(channelId: string, memberId: string) {
	const participants = rooms.get(channelId)
	if (!participants?.delete(memberId)) return
	if (participants.size === 0) {
		rooms.delete(channelId)
		// The Audience just emptied — freeze the Watch Session now (adr/0009).
		// LiveKit's room_finished also calls this, but only after empty_timeout
		// (300s by default), by which point the anchor has run five minutes past
		// where everyone actually stopped watching.
		watchRoomFinished(channelId)
	}
	broadcastVoice()
}

export function voiceRoomFinished(channelId: string) {
	if (rooms.delete(channelId)) broadcastVoice()
}

export function voiceSetScreenShare(channelId: string, memberId: string, on: boolean) {
	const participant = rooms.get(channelId)?.get(memberId)
	if (!participant || participant.screenSharing === on) return
	participant.screenSharing = on
	broadcastVoice()
}

export function voiceSetCamera(channelId: string, memberId: string, on: boolean) {
	const participant = rooms.get(channelId)?.get(memberId)
	if (!participant || participant.cameraOn === on) return
	participant.cameraOn = on
	broadcastVoice()
}

export function voiceSetMutedByMember(memberId: string, muted: boolean) {
	for (const participants of rooms.values()) {
		const participant = participants.get(memberId)
		if (participant && participant.muted !== muted) {
			participant.muted = muted
			broadcastVoice()
			return
		}
	}
}
