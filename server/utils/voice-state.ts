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

export function voiceParticipantJoined(channelId: string, memberId: string, username: string) {
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
	if (participants.size === 0) rooms.delete(channelId)
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
