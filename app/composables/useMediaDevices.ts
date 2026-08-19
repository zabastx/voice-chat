// One device list, shared by the settings panel and the control-bar device picker.
//
// Both surfaces need the same three lists, the same «По умолчанию» sentinel, and the same
// reaction to hardware appearing and disappearing — so enumeration lives here rather than
// being copied into each panel, where the two copies would drift apart.

export type DevicePrefKey = 'micDeviceId' | 'speakerDeviceId' | 'cameraDeviceId'

export interface DeviceOption {
	label: string
	value: string
}

// Output-device selection is Chromium-only (Firefox has no `setSinkId`). A Playback Device is
// the one choice here that can be unavailable, so both surfaces ask the same question.
export const speakerSupported = import.meta.client && 'setSinkId' in HTMLMediaElement.prototype

// a single `devicechange` listener no matter how many surfaces are open
let listeners = 0
let onDeviceChange: (() => void) | null = null
// Which lists have been enumerated at least once *trustworthily* (see `pruneMissing`). A device
// missing from the first trustworthy look was already gone before anyone could have chosen it
// in this session; one that goes missing afterwards vanished under the member's hands, and only
// that second case is worth a toast. Per list, because the trustworthy moment differs per kind:
// every list is untrustworthy until a permission grant, and outputs stay that way in Firefox.
const trustedOnce = new Set<DevicePrefKey>()

export function useMediaDevices() {
	const prefs = usePreferences()
	const toast = useToast()

	const mics = useState<MediaDeviceInfo[]>('devices-mics', () => [])
	const speakers = useState<MediaDeviceInfo[]>('devices-speakers', () => [])
	const cameras = useState<MediaDeviceInfo[]>('devices-cameras', () => [])
	// getLocalDevices threw for audio — the browser refused, so nothing can be listed
	const denied = useState('devices-denied', () => false)

	// Until a getUserMedia grant, enumerateDevices returns placeholders — and a placeholder has
	// an empty `deviceId` as well as an empty label, so «has an id but no label» silently never
	// matches and the picker would show a list of nothing with no way to fix it. Count only
	// entries that could actually be selected: none of those means no grant.
	const needsPermission = computed(() => {
		const usable = mics.value.filter((d) => d.deviceId)
		return usable.length === 0 || usable.some((d) => !d.label)
	})

	// 'default' doubles as the sentinel for «системное по умолчанию»: Chrome's own
	// 'default' pseudo-device is filtered out, and Reka Select forbids '' values (gotcha 6)
	function toOptions(devices: MediaDeviceInfo[]): DeviceOption[] {
		return [
			{ label: 'По умолчанию', value: 'default' },
			...devices
				.filter((d) => d.deviceId && d.deviceId !== 'default')
				.map((d) => ({ label: d.label || 'Устройство', value: d.deviceId }))
		]
	}

	const micItems = computed(() => toOptions(mics.value))
	const speakerItems = computed(() => toOptions(speakers.value))
	const cameraItems = computed(() => toOptions(cameras.value))

	/**
	 * Two-way binding for one device preference, with the «По умолчанию» sentinel translated to
	 * and from `null` in a single place. Every surface binds a `USelect` through this: the
	 * sentinel is the exact thing gotcha 6 is about, and a second copy of the translation is
	 * precisely how two pickers would come to disagree.
	 *
	 * Writing is all a surface does — the watcher in `useVoice` is what reaches the live room.
	 */
	function deviceModel(key: DevicePrefKey) {
		return computed({
			get: () => prefs.value[key] ?? 'default',
			set: (value: string) => {
				prefs.value[key] = value === 'default' ? null : value
			}
		})
	}

	const checks = [
		{ list: mics, key: 'micDeviceId', label: 'Микрофон' },
		{ list: speakers, key: 'speakerDeviceId', label: 'Устройство вывода' },
		{ list: cameras, key: 'cameraDeviceId', label: 'Камера' }
	] as const satisfies readonly {
		list: Ref<MediaDeviceInfo[]>
		key: DevicePrefKey
		label: string
	}[]

	/**
	 * Drop stored ids that no longer resolve.
	 *
	 * A stale id is not a device that might come back: Chrome mints fresh per-origin ids when
	 * site permissions are reset, so the stored string can never match again — and `join()`
	 * would keep handing it to LiveKit as `audioCaptureDefaults` forever.
	 *
	 * Only ever prune against a list we can trust. Without a permission grant (and in Firefox,
	 * for outputs at all) enumeration returns label-less placeholders or nothing, and pruning
	 * against *that* would wipe every preference the member has ever set.
	 */
	function pruneMissing() {
		for (const { list, key, label } of checks) {
			const trusted = list.value.some((d) => d.deviceId && d.label)
			if (!trusted) continue
			// Marked before the early return below, so a device that is present now and gone
			// later still announces itself. Note this is the first *trustworthy* look, not the
			// first look at all: a member who grants permission from the picker gets their first
			// real list several enumerations in, and that one is still "startup" as far as they
			// are concerned — toasting there would announce a device they never chose today.
			const firstTrustworthyLook = !trustedOnce.has(key)
			trustedOnce.add(key)

			const stored = prefs.value[key]
			if (!stored) continue
			if (list.value.some((d) => d.deviceId === stored)) continue

			prefs.value[key] = null
			if (firstTrustworthyLook) continue
			toast.add({
				title: `${label} отключён`,
				description: 'Выбрано системное устройство по умолчанию.',
				color: 'warning',
				icon: 'i-lucide-unplug'
			})
		}
	}

	/**
	 * Re-read the device lists. `requestPermissions` fires the browser's permission prompt when
	 * it hasn't happened yet — the settings panel does that on open, the picker only on an
	 * explicit «Разрешить доступ» click, so merely opening a dropdown never prompts.
	 */
	async function refresh({ requestPermissions = false } = {}) {
		const { Room } = await import('livekit-client')
		try {
			mics.value = await Room.getLocalDevices('audioinput', requestPermissions)
			speakers.value = await Room.getLocalDevices('audiooutput', false)
			denied.value = false
		} catch {
			denied.value = true
		}
		try {
			cameras.value = await Room.getLocalDevices('videoinput', requestPermissions)
		} catch {
			// камеры может не быть — селект просто останется с «По умолчанию»
		}
		pruneMissing()
	}

	// Refcounted so two open surfaces share one listener and the first one to close doesn't
	// take the other's updates away with it.
	let holdsListener = false

	function setListening(on: boolean) {
		if (on === holdsListener) return
		holdsListener = on
		listeners += on ? 1 : -1
		if (on && listeners === 1) {
			onDeviceChange = () => void refresh()
			navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange)
		} else if (listeners === 0 && onDeviceChange) {
			navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange)
			onDeviceChange = null
		}
	}

	/** React to hardware being plugged in or pulled out while this surface is showing. */
	function startListening() {
		setListening(true)
	}

	function stopListening() {
		setListening(false)
	}

	onScopeDispose(stopListening)

	return {
		mics,
		speakers,
		cameras,
		denied,
		needsPermission,
		speakerSupported,
		micItems,
		speakerItems,
		cameraItems,
		deviceModel,
		refresh,
		startListening,
		stopListening
	}
}
