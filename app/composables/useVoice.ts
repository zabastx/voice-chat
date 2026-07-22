import type { LocalTrack, RemoteTrack, Room } from 'livekit-client'

import ShareSettingsModal from '../components/ShareSettingsModal.vue'
import type { ScreenSharePresetId } from './usePreferences'

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
// one cached ShareSettingsModal controller; created lazily on first share click
type ShareOverlayController = ReturnType<ReturnType<typeof useOverlay>['create']>
let shareOverlay: ShareOverlayController | null = null

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
					// re-apply this listener's stored local volume/mute for the speaker;
					// livekit's per-participant volume lives on the room and is lost on leave
					applyLocalVolume(participant.identity)
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
			if (sharing.value) {
				await room.localParticipant.setScreenShareEnabled(false)
				sharing.value = room.localParticipant.isScreenShareEnabled
				return
			}
			// open the pre-share dialog (quality preset). Confirm returns the chosen
			// preset; cancel (or backdrop/Esc) returns undefined → no share attempt.
			if (!shareOverlay) {
				const overlay = useOverlay()
				shareOverlay = overlay.create(ShareSettingsModal) as ShareOverlayController
			}
			const prefs = usePreferences()
			const instance = shareOverlay.open({ preset: prefs.value.screenSharePreset })
			const chosen = (await instance.result) as ScreenSharePresetId | undefined
			if (!chosen) return
			// persist the choice so the next share dialog opens on the previous one —
			// Preferences lives in localStorage and the prefs watcher auto-persists
			prefs.value.screenSharePreset = chosen
			// resolve the LiveKit ScreenSharePreset object from the user-facing id
			const livekit = await import('livekit-client')
			const presetMap = {
				h1080fps15: livekit.ScreenSharePresets.h1080fps15,
				h1080fps30: livekit.ScreenSharePresets.h1080fps30,
				original: livekit.ScreenSharePresets.original
			} satisfies Record<ScreenSharePresetId, (typeof livekit.ScreenSharePresets)['h1080fps15']>
			const preset = presetMap[chosen]
			await room.localParticipant.setScreenShareEnabled(
				true,
				{ audio: true, resolution: preset.resolution },
				{ screenShareEncoding: preset.encoding }
			)
			sharing.value = room.localParticipant.isScreenShareEnabled
		} catch {
			// user dismissed the browser's share picker, or capture failed
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

	// --- local (client-side only) per-speaker volume/mute; see ADR 0003 ---

	function localVolume(identity: string) {
		return prefs.value.localVolumes[identity]?.volume ?? 100
	}

	function isLocallyMuted(identity: string) {
		return prefs.value.localVolumes[identity]?.muted ?? false
	}

	// push the stored preference onto the live LiveKit track (0 while muted)
	function applyLocalVolume(identity: string) {
		const entry = prefs.value.localVolumes[identity]
		const value = entry ? (entry.muted ? 0 : entry.volume / 100) : 1
		room?.remoteParticipants.get(identity)?.setVolume(value)
	}

	function setLocalVolume(identity: string, volume: number) {
		const clamped = Math.round(Math.min(200, Math.max(0, volume)))
		const current = prefs.value.localVolumes[identity]
		// dragging the slider off zero clears a local mute (Discord behaviour)
		prefs.value.localVolumes = {
			...prefs.value.localVolumes,
			[identity]: { volume: clamped, muted: clamped > 0 ? false : (current?.muted ?? false) }
		}
		applyLocalVolume(identity)
	}

	function toggleLocalMute(identity: string) {
		const current = prefs.value.localVolumes[identity] ?? { volume: 100, muted: false }
		prefs.value.localVolumes = {
			...prefs.value.localVolumes,
			[identity]: { ...current, muted: !current.muted }
		}
		applyLocalVolume(identity)
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
		localVolume,
		isLocallyMuted,
		setLocalVolume,
		toggleLocalMute,
		setDevice
	}
}
