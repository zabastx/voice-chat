// per-device user preferences, persisted in localStorage (device ids are
// per-machine, so they don't belong on the server)
// per-speaker playback preference, applied only in this browser (see ADR 0003)
export interface LocalVolume {
	volume: number // percent, 0–200; 100 = unchanged
	muted: boolean // local mute, independent of `volume` so it preserves the level
}

export interface Preferences {
	micDeviceId: string | null
	speakerDeviceId: string | null
	cameraDeviceId: string | null
	messageSound: boolean
	desktopNotifications: boolean
	showOfflineMembers: boolean
	// per-speaker local volume/mute, keyed by the speaker's member id; sparse
	localVolumes: Record<string, LocalVolume>
	// last app version whose changelog the user has seen; null until first load seeds it
	lastSeenVersion: string | null
}

const STORAGE_KEY = 'voice-chat:prefs'

function defaults(): Preferences {
	return {
		micDeviceId: null,
		speakerDeviceId: null,
		cameraDeviceId: null,
		messageSound: true,
		desktopNotifications: false,
		showOfflineMembers: false,
		localVolumes: {},
		lastSeenVersion: null
	}
}

export function usePreferences() {
	const prefs = useState<Preferences>('prefs', defaults)
	const loaded = useState('prefs-loaded', () => false)

	if (import.meta.client && !loaded.value) {
		loaded.value = true
		try {
			const raw = localStorage.getItem(STORAGE_KEY)
			if (raw) prefs.value = { ...defaults(), ...JSON.parse(raw) }
		} catch {
			// corrupted storage — keep defaults
		}
		// detached scope: the watcher must outlive whichever component called this first
		effectScope(true).run(() => {
			watch(
				prefs,
				(value) => {
					localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
				},
				{ deep: true }
			)
		})
	}

	return prefs
}
