import type { RemoteTrack, Room } from 'livekit-client'

interface ScreenShareRef {
	identity: string
	name: string
	sid: string
}

let room: Room | null = null
const audioElements = new Set<HTMLMediaElement>()
const remoteScreenTracks = new Map<string, RemoteTrack>()

export function useVoice() {
	const toast = useToast()
	const realtime = useRealtime()

	const currentChannelId = useState<string | null>('voice-channel', () => null)
	const connecting = useState('voice-connecting', () => false)
	const muted = useState('voice-muted', () => false)
	const sharing = useState('voice-sharing', () => false)
	const speakingIds = useState<string[]>('voice-speaking', () => [])
	const screenShares = useState<ScreenShareRef[]>('voice-screens', () => [])

	function reset() {
		currentChannelId.value = null
		muted.value = false
		sharing.value = false
		speakingIds.value = []
		screenShares.value = []
		remoteScreenTracks.clear()
		for (const el of audioElements) el.remove()
		audioElements.clear()
		room = null
	}

	async function join(channelId: string) {
		if (import.meta.server || currentChannelId.value === channelId || connecting.value) return
		connecting.value = true
		try {
			const livekit = await import('livekit-client')
			if (room) await leave()

			const { token, url } = await $fetch<{ token: string; url: string }>(
				`/api/channels/${channelId}/voice-token`,
				{ method: 'POST' }
			)

			const nextRoom = new livekit.Room()

			nextRoom.on(livekit.RoomEvent.TrackSubscribed, (track, publication, participant) => {
				if (track.kind === livekit.Track.Kind.Audio) {
					const el = track.attach()
					document.body.appendChild(el)
					audioElements.add(el)
				} else if (publication.source === livekit.Track.Source.ScreenShare) {
					remoteScreenTracks.set(publication.trackSid, track)
					screenShares.value = [
						...screenShares.value,
						{
							identity: participant.identity,
							name: participant.name || participant.identity,
							sid: publication.trackSid
						}
					]
				}
			})

			nextRoom.on(livekit.RoomEvent.TrackUnsubscribed, (track, publication) => {
				for (const el of track.detach()) {
					el.remove()
					audioElements.delete(el)
				}
				if (remoteScreenTracks.delete(publication.trackSid)) {
					screenShares.value = screenShares.value.filter((s) => s.sid !== publication.trackSid)
				}
			})

			nextRoom.on(livekit.RoomEvent.ActiveSpeakersChanged, (speakers) => {
				speakingIds.value = speakers.map((s) => s.identity)
			})

			nextRoom.on(livekit.RoomEvent.LocalTrackUnpublished, (publication) => {
				// covers the browser's own "stop sharing" button
				if (publication.source === livekit.Track.Source.ScreenShare) {
					sharing.value = false
				}
			})

			nextRoom.on(livekit.RoomEvent.Disconnected, () => {
				reset()
			})

			await nextRoom.connect(url, token)
			room = nextRoom
			currentChannelId.value = channelId

			let micOn = false
			try {
				await nextRoom.localParticipant.setMicrophoneEnabled(true)
				micOn = true
			} catch {
				toast.add({
					title: 'Вы подключились без микрофона',
					description:
						'Не удалось получить доступ к микрофону — вы можете слушать, но не говорить.',
					color: 'warning',
					icon: 'i-lucide-mic-off'
				})
			}
			muted.value = !micOn
			realtime.send({ type: 'voice.self', muted: !micOn })
			playJoinSound()
		} catch (e) {
			toast.add({
				title: 'Не удалось подключиться к голосовому каналу',
				description: e instanceof Error ? e.message : undefined,
				color: 'error'
			})
			reset()
		} finally {
			connecting.value = false
		}
	}

	async function leave() {
		const current = room
		room = null
		if (current) {
			playLeaveSound()
			await current.disconnect()
		}
		reset()
	}

	async function toggleMute() {
		if (!room) return
		const nextMuted = !muted.value
		await room.localParticipant.setMicrophoneEnabled(!nextMuted)
		muted.value = nextMuted
		realtime.send({ type: 'voice.self', muted: nextMuted })
	}

	async function toggleScreenShare() {
		if (!room) return
		try {
			await room.localParticipant.setScreenShareEnabled(!sharing.value, { audio: true })
			sharing.value = room.localParticipant.isScreenShareEnabled
		} catch {
			// user dismissed the share picker
			sharing.value = room?.localParticipant.isScreenShareEnabled ?? false
		}
	}

	function screenTrackFor(sid: string) {
		return remoteScreenTracks.get(sid)
	}

	return {
		currentChannelId,
		connecting,
		muted,
		sharing,
		speakingIds,
		screenShares,
		join,
		leave,
		toggleMute,
		toggleScreenShare,
		screenTrackFor
	}
}
