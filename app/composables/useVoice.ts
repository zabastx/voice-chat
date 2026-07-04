import type { LocalTrack, RemoteTrack, Room } from 'livekit-client'

interface ScreenShareRef {
	identity: string
	name: string
	sid: string
}

interface CameraTile {
	identity: string
	sid: string
}

let room: Room | null = null
const audioElements = new Set<HTMLMediaElement>()
const remoteScreenTracks = new Map<string, RemoteTrack>()
const remoteCameraTracks = new Map<string, RemoteTrack>()
let localCameraTrack: LocalTrack | null = null

export function useVoice() {
	const toast = useToast()
	const realtime = useRealtime()
	const prefs = usePreferences()

	const currentChannelId = useState<string | null>('voice-channel', () => null)
	const connecting = useState('voice-connecting', () => false)
	const muted = useState('voice-muted', () => false)
	const sharing = useState('voice-sharing', () => false)
	const camera = useState('voice-camera', () => false)
	const speakingIds = useState<string[]>('voice-speaking', () => [])
	const screenShares = useState<ScreenShareRef[]>('voice-screens', () => [])
	const cameraTiles = useState<CameraTile[]>('voice-cameras', () => [])

	function reset() {
		currentChannelId.value = null
		muted.value = false
		sharing.value = false
		camera.value = false
		speakingIds.value = []
		screenShares.value = []
		cameraTiles.value = []
		remoteScreenTracks.clear()
		remoteCameraTracks.clear()
		localCameraTrack = null
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

			const nextRoom = new livekit.Room({
				audioCaptureDefaults: prefs.value.micDeviceId
					? { deviceId: prefs.value.micDeviceId }
					: undefined,
				videoCaptureDefaults: prefs.value.cameraDeviceId
					? { deviceId: prefs.value.cameraDeviceId }
					: undefined,
				audioOutput: prefs.value.speakerDeviceId
					? { deviceId: prefs.value.speakerDeviceId }
					: undefined
			})

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
				} else if (publication.source === livekit.Track.Source.Camera) {
					remoteCameraTracks.set(participant.identity, track)
					cameraTiles.value = [
						...cameraTiles.value.filter((t) => t.identity !== participant.identity),
						{ identity: participant.identity, sid: publication.trackSid }
					]
				}
			})

			nextRoom.on(livekit.RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
				for (const el of track.detach()) {
					el.remove()
					audioElements.delete(el)
				}
				if (remoteScreenTracks.delete(publication.trackSid)) {
					screenShares.value = screenShares.value.filter((s) => s.sid !== publication.trackSid)
				}
				if (publication.source === livekit.Track.Source.Camera) {
					remoteCameraTracks.delete(participant.identity)
					cameraTiles.value = cameraTiles.value.filter((t) => t.sid !== publication.trackSid)
				}
			})

			nextRoom.on(livekit.RoomEvent.ActiveSpeakersChanged, (speakers) => {
				speakingIds.value = speakers.map((s) => s.identity)
			})

			// setCameraEnabled(false) mutes rather than unpublishes, and on unmute livekit
			// reuses the video element's MediaStream without replaying it (black feed in
			// Chrome). Dropping the tile on mute and re-adding it on unmute forces VoiceTile
			// to do a fresh attach() — and shows the avatar while the camera is off.
			nextRoom.on(livekit.RoomEvent.TrackMuted, (publication, participant) => {
				if (publication.source === livekit.Track.Source.Camera) {
					cameraTiles.value = cameraTiles.value.filter((t) => t.identity !== participant.identity)
				}
			})

			nextRoom.on(livekit.RoomEvent.TrackUnmuted, (publication, participant) => {
				if (publication.source === livekit.Track.Source.Camera) {
					cameraTiles.value = [
						...cameraTiles.value.filter((t) => t.identity !== participant.identity),
						{ identity: participant.identity, sid: publication.trackSid }
					]
				}
			})

			nextRoom.on(livekit.RoomEvent.LocalTrackPublished, (publication, participant) => {
				if (publication.source === livekit.Track.Source.Camera && publication.track) {
					localCameraTrack = publication.track
					cameraTiles.value = [
						...cameraTiles.value.filter((t) => t.identity !== participant.identity),
						{ identity: participant.identity, sid: publication.trackSid }
					]
				}
			})

			nextRoom.on(livekit.RoomEvent.LocalTrackUnpublished, (publication, participant) => {
				// covers the browser's own "stop sharing" button
				if (publication.source === livekit.Track.Source.ScreenShare) {
					sharing.value = false
				} else if (publication.source === livekit.Track.Source.Camera) {
					localCameraTrack = null
					camera.value = false
					cameraTiles.value = cameraTiles.value.filter((t) => t.identity !== participant.identity)
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

	async function toggleCamera() {
		if (!room) return
		try {
			await room.localParticipant.setCameraEnabled(!camera.value)
			camera.value = room.localParticipant.isCameraEnabled
		} catch {
			camera.value = room.localParticipant.isCameraEnabled
			toast.add({
				title: 'Не удалось включить камеру',
				description: 'Проверьте, что камера подключена и доступ к ней разрешён.',
				color: 'error',
				icon: 'i-lucide-video-off'
			})
		}
	}

	function screenTrackFor(sid: string) {
		return remoteScreenTracks.get(sid)
	}

	function cameraTrackFor(identity: string) {
		if (room && identity === room.localParticipant.identity) return localCameraTrack ?? undefined
		return remoteCameraTracks.get(identity)
	}

	// switch an input/output device mid-call; no-op when not connected
	async function setDevice(kind: MediaDeviceKind, deviceId: string | null) {
		if (!room) return
		try {
			await room.switchActiveDevice(kind, deviceId ?? 'default')
		} catch {
			toast.add({ title: 'Не удалось переключить устройство', color: 'error' })
		}
	}

	return {
		currentChannelId,
		connecting,
		muted,
		sharing,
		camera,
		speakingIds,
		screenShares,
		cameraTiles,
		join,
		leave,
		toggleMute,
		toggleScreenShare,
		toggleCamera,
		screenTrackFor,
		cameraTrackFor,
		setDevice
	}
}
