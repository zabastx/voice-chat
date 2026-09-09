import type { LocalAudioTrack, LocalTrack, RemoteTrack, Room } from 'livekit-client'

import ShareSettingsModal from '../components/ShareSettingsModal.vue'
import type { MicGate, MicGateSettings } from '../utils/mic-gate'
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
// guards re-entrant share clicks: reopening the dialog would overwrite the first
// open()'s resolvePromise and orphan its awaiting caller forever. Reset in a finally.
let shareDialogOpen = false
// the live noise gate, attached to the published mic track while micMode is 'gate'
let micGate: MicGate | null = null
// Set while writing a revert back into the preferences, so the device watchers ignore their own
// write. Without it the revert fires a second switch — back to the device we just came from —
// which can fail in its own right and toast twice for one failed change. Module scope because
// only the once-installed watchers below read it; a copy per useVoice() caller would be dead.
let revertingDevice = false
// every device preference and the LiveKit device kind it drives; one place to add a fourth
const DEVICE_PREFS = [
	{ kind: 'audioinput', key: 'micDeviceId' },
	{ kind: 'audiooutput', key: 'speakerDeviceId' },
	{ kind: 'videoinput', key: 'cameraDeviceId' }
] as const satisfies readonly { kind: MediaDeviceKind; key: DevicePrefKey }[]
// the prefs watcher below must outlive every component, so it is installed once per page load
let micWatcherStarted = false

// Safari 17 has a getDisplayMedia bug where passing any resolution constraint yields a
// low-res capture (see livekit-client ScreenShareCaptureOptions docs), so we omit the
// resolution there and let capture run native; other browsers cap it to the preset's 1080.
function isSafariBrowser(): boolean {
	if (typeof navigator === 'undefined') return false
	return /^((?!chrome|android|crios|fxios).)*safari/i.test(navigator.userAgent)
}

export function useVoice() {
	const toast = useToast()
	const realtime = useRealtime()
	const prefs = usePreferences()
	// Desktop Client only: lets the shell hold a pending update back until the call ends.
	// In a browser, and in a client whose bridge predates the capability, this is a no-op
	// and the call behaves exactly the same (adr/0013).
	const desktop = useNativeDesktop()

	const currentChannelId = useState<string | null>('voice-channel', () => null)
	const connecting = useState('voice-connecting', () => false)
	const muted = useState('voice-muted', () => false)
	const sharing = useState('voice-sharing', () => false)
	const camera = useState('voice-camera', () => false)
	const speakingIds = useState<string[]>('voice-speaking', () => [])
	const screenShares = useState<ScreenShareRef[]>('voice-screens', () => [])
	const cameraTiles = useState<CameraTile[]>('voice-cameras', () => [])
	// live mic level (0–100 on the shared audio-level scale) and gate state, produced only
	// while something is monitoring — see setMicMonitoring
	const micLevel = useState('voice-mic-level', () => 0)
	const micGateOpen = useState('voice-mic-gate-open', () => true)
	const micMonitoring = useState('voice-mic-monitoring', () => false)
	// whether a gate is *actually attached* right now — not the same as `micMode === 'gate'`,
	// which is only an intent. The settings meter keys off this, so that after a failed attach
	// it falls back to the mic test instead of showing a permanently flat bar
	const micGateActive = useState('voice-mic-gate-active', () => false)

	function reset() {
		desktop.setVoiceActive(false)
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
		// LiveKit stops the mic track on disconnect but doesn't necessarily run the
		// processor's destroy, and ours owns an AudioContext — one leaked per call otherwise
		void micGate?.destroy()
		micGate = null
		micGateActive.value = false
		micLevel.value = 0
		micGateOpen.value = true
		room = null
	}

	// --- microphone noise gate (client-side only; see ADR 0010) ---

	function gateSettings(): MicGateSettings {
		return {
			enabled: prefs.value.micMode === 'gate',
			// the UI's 0–100 threshold is converted here, once, so the audio thread only ever
			// compares RMS against RMS and can't disagree with the meter
			thresholdRms: levelToRms(prefs.value.gateThreshold),
			holdMs: prefs.value.gateHold
		}
	}

	async function localMicTrack(): Promise<LocalAudioTrack | null> {
		if (!room) return null
		const livekit = await import('livekit-client')
		const track = room.localParticipant.getTrackPublication(
			livekit.Track.Source.Microphone
		)?.audioTrack
		// the publication is local, so this is a LocalAudioTrack — the union on
		// TrackPublication.audioTrack is what needs narrowing, not the value
		return track && 'setProcessor' in track ? track : null
	}

	// attach, update, or detach the gate to match the current preferences. Safe to call at
	// any time: a no-op when not connected, and re-entrant only through awaited LiveKit calls.
	async function applyMicMode() {
		const track = await localMicTrack()
		if (!track) return
		const settings = gateSettings()

		if (settings.enabled) {
			// The handle alone is not proof: enabling the microphone with no existing
			// publication makes LiveKit create and publish a *brand-new, unprocessed* track
			// (`setTrackEnabled` → `createTracks` + `publishTrack`), which is what happens when
			// someone joins without a mic and then unmutes. Trusting `micGate` there would
			// leave them transmitting wide open while the UI says the gate is on — so ask the
			// track what is actually installed.
			if (micGate && track.getProcessor() === micGate) {
				micGate.update(settings)
				return
			}
			if (micGate) {
				const stale = micGate
				micGate = null
				void stale.destroy()
			}
			const gate = createMicGate(settings)
			gate.onLevel = (level, open) => {
				micLevel.value = level
				micGateOpen.value = open
			}
			gate.setMonitor(micMonitoring.value)
			micGate = gate
			try {
				await track.setProcessor(gate)
				if (micGate === gate) micGateActive.value = true
			} catch {
				void gate.destroy()
				// A newer attach (or a disconnect) may have replaced this one while it was in
				// flight. Only the attempt that is still current reports anything — otherwise a
				// stale rejection clobbers the live gate's handle and silently kills the meter.
				if (micGate !== gate) return
				micGate = null
				micGateActive.value = false
				// AudioWorklet unavailable or the module failed to load — fall back to the
				// open mic rather than leaving a half-built graph in the signal path
				toast.add({
					title: 'Не удалось включить шумовой порог',
					description: 'Микрофон работает в обычном режиме.',
					color: 'warning',
					icon: 'i-lucide-mic'
				})
			}
			return
		}

		if (micGate) {
			const gate = micGate
			micGate = null
			micGateActive.value = false
			micLevel.value = 0
			micGateOpen.value = true
			try {
				await track.stopProcessor()
			} catch {
				// stopProcessor stops the processed track *before* restoring the raw one, so a
				// failure partway through (an ended device, stored constraints that no longer
				// apply) leaves the RTP sender on a stopped track — the member is inaudible to
				// everyone and has no way to tell. Re-acquiring the device repairs the sender.
				try {
					await track.restartTrack()
				} catch {
					toast.add({
						title: 'Микрофон отключился',
						description: 'Переподключитесь к голосовому каналу, чтобы вас снова слышали.',
						color: 'error',
						icon: 'i-lucide-mic-off'
					})
				}
			}
			void gate.destroy()
		}
	}

	// Level reporting costs a postMessage every 50 ms, so it is opt-in: the settings panel
	// turns it on while it is showing the meter and off again when it closes.
	function setMicMonitoring(on: boolean) {
		micMonitoring.value = on
		micGate?.setMonitor(on)
		if (!on) micLevel.value = 0
	}

	// --- capture / playback device selection ---

	// Switch a device on the live room, or put the preference back if the browser refuses.
	// Leaving a failed choice in place would have the picker naming a device that is
	// demonstrably not live, with nothing to tell the member apart from a toast they may have
	// missed — the same reason `toggleMute` resyncs from the room instead of trusting itself.
	async function applyDevice(kind: MediaDeviceKind, deviceId: string | null, revert: () => void) {
		if (!room) return
		try {
			await room.switchActiveDevice(kind, deviceId ?? 'default')
		} catch {
			revertingDevice = true
			revert()
			void nextTick(() => {
				revertingDevice = false
			})
			toast.add({
				title: 'Не удалось переключить устройство',
				description: 'Оно занято другой программой или было отключено.',
				color: 'error'
			})
		}
	}

	if (import.meta.client && !micWatcherStarted) {
		micWatcherStarted = true
		// detached scope: this must outlive whichever component called useVoice() first
		const scope = effectScope(true)
		scope.run(() => {
			watch(
				() => [prefs.value.micMode, prefs.value.gateThreshold, prefs.value.gateHold],
				() => {
					void applyMicMode()
				}
			)
			// Every surface that lets a member pick a device writes these preferences and
			// nothing else — the settings panel and the control-bar picker both do. Applying
			// them here rather than in a component is what makes a write from *any* surface
			// reach the live room, and it is why the camera finally switches mid-call instead
			// of being read once in join() and ignored until the next reconnect.
			for (const { kind, key } of DEVICE_PREFS) {
				watch(
					() => prefs.value[key],
					(id, previous) => {
						if (revertingDevice) return
						void applyDevice(kind, id, () => {
							prefs.value[key] = previous
						})
					}
				)
			}
		})
		// HMR resets `micWatcherStarted`, so without this every edit to this file stacks
		// another watcher onto the old ones and each slider tick fans out across all of them
		if (import.meta.hot) import.meta.hot.dispose(() => scope.stop())
	}

	async function join(channelId: string) {
		if (import.meta.server || currentChannelId.value === channelId || connecting.value) return
		connecting.value = true
		try {
			const livekit = await import('livekit-client')
			if (room) await leave()
			// overlap the module fetch with the connect round-trip: the gate cannot attach
			// until the mic is published, so anything still being fetched at that point is
			// time spent transmitting ungated
			if (prefs.value.micMode === 'gate') prefetchMicGateWorklet()

			const { token, url } = await $fetch<{ token: string; url: string }>(
				`/api/channels/${channelId}/voice-token`,
				{ method: 'POST' }
			)

			const nextRoom = new livekit.Room({
				// Subscribe to video only where video is actually being shown, and at the
				// layer the tile is actually sized for. Both default to false in
				// livekit-client, and without them a member who joins a call and then goes
				// to read a text channel keeps decoding somebody's 1080p screen share into
				// memory with nothing on screen to render it; the Watch Together filmstrip
				// (168×96 tiles) pulls full-resolution layers too. This works because every
				// tile attaches its track to a real element — see VoiceTile — which is what
				// adaptiveStream watches for visibility and size.
				adaptiveStream: true,
				// the publisher side of the same idea: stop encoding layers nobody subscribes to
				dynacast: true,
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
			desktop.setVoiceActive(true)

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
			// the gate rides on the published mic track, so there is nothing to attach when
			// the member joined without a microphone
			if (micOn) await applyMicMode()
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
		try {
			await room.localParticipant.setMicrophoneEnabled(!nextMuted)
		} catch {
			// the device can be gone or held by another app — resync the button to reality
			// instead of leaving it showing a state that never took
			muted.value = !room.localParticipant.isMicrophoneEnabled
			toast.add({
				title: 'Не удалось переключить микрофон',
				description: 'Проверьте, что микрофон подключён и доступ к нему разрешён.',
				color: 'error',
				icon: 'i-lucide-mic-off'
			})
			return
		}
		muted.value = nextMuted
		realtime.send({ type: 'voice.self', muted: nextMuted })
		// Unmuting when nothing is published makes LiveKit publish a fresh, unprocessed track
		// (the mic-denied-at-join path), so the gate has to be re-checked here and not only in
		// join() — otherwise the member goes live wide open while settings say «Шумовой порог».
		if (!nextMuted) await applyMicMode()
	}

	async function toggleScreenShare() {
		if (!room) return
		try {
			if (sharing.value) {
				await room.localParticipant.setScreenShareEnabled(false)
				sharing.value = room.localParticipant.isScreenShareEnabled
				return
			}
			// single-instance dialog: ignore clicks while it's already open
			if (shareDialogOpen) return
			shareDialogOpen = true
			try {
				// open the pre-share dialog (quality preset). Confirm returns the chosen
				// preset; cancel (or backdrop/Esc) returns undefined → no share attempt.
				if (!shareOverlay) {
					const overlay = useOverlay()
					shareOverlay = overlay.create(ShareSettingsModal) as ShareOverlayController
				}
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
					{ audio: true, ...(isSafariBrowser() ? {} : { resolution: preset.resolution }) },
					{ screenShareEncoding: preset.encoding }
				)
				sharing.value = room.localParticipant.isScreenShareEnabled
			} finally {
				shareDialogOpen = false
			}
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

	return {
		currentChannelId,
		connecting,
		muted,
		sharing,
		camera,
		speakingIds,
		screenShares,
		cameraTiles,
		micLevel,
		micGateOpen,
		micGateActive,
		setMicMonitoring,
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
		toggleLocalMute
	}
}
