<template>
	<div class="space-y-8">
		<h2 class="text-highlighted text-lg font-semibold">Голос и видео</h2>

		<UAlert
			v-if="permissionError"
			color="warning"
			description="Разрешите доступ в настройках браузера и откройте эту вкладку снова."
			icon="i-lucide-mic-off"
			title="Нет доступа к микрофону или камере"
			variant="subtle"
		/>

		<section class="space-y-4">
			<UFormField label="Микрофон" name="mic">
				<USelect v-model="micId" :items="micItems" class="w-full max-w-xs" />
			</UFormField>

			<div class="space-y-2">
				<UButton
					:icon="testing ? 'i-lucide-square' : 'i-lucide-mic'"
					:label="testing ? 'Остановить проверку' : 'Проверить микрофон'"
					color="neutral"
					variant="soft"
					@click="toggleMicTest"
				/>
				<UProgress v-if="testing" :model-value="level" :max="100" color="success" size="lg" />
				<p v-if="testing" class="text-muted text-xs">
					Скажите что-нибудь — индикатор должен реагировать на голос.
				</p>
			</div>
		</section>

		<section class="space-y-1">
			<UFormField label="Динамики" name="speaker">
				<USelect
					v-model="speakerId"
					:disabled="!speakerSupported"
					:items="speakerItems"
					class="w-full max-w-xs"
				/>
			</UFormField>
			<p v-if="!speakerSupported" class="text-muted text-xs">
				Выбор устройства вывода не поддерживается этим браузером.
			</p>
		</section>

		<section class="space-y-3">
			<UFormField label="Камера" name="camera">
				<USelect v-model="cameraId" :items="cameraItems" class="w-full max-w-xs" />
			</UFormField>

			<UButton
				:icon="previewing ? 'i-lucide-video-off' : 'i-lucide-video'"
				:label="previewing ? 'Выключить предпросмотр' : 'Включить предпросмотр'"
				color="neutral"
				variant="soft"
				@click="togglePreview"
			/>
			<video
				v-show="previewing"
				ref="videoEl"
				autoplay
				class="bg-elevated aspect-video w-full max-w-md rounded-lg"
				muted
				playsinline
			/>
		</section>
	</div>
</template>

<script lang="ts" setup>
const toast = useToast()
const prefs = usePreferences()
const voice = useVoice()

const permissionError = ref(false)
const mics = ref<MediaDeviceInfo[]>([])
const speakers = ref<MediaDeviceInfo[]>([])
const cameras = ref<MediaDeviceInfo[]>([])

const speakerSupported = import.meta.client && 'setSinkId' in HTMLMediaElement.prototype

// 'default' doubles as the sentinel for «системное по умолчанию»: Chrome's own
// 'default' pseudo-device is filtered out, and Reka Select forbids '' values
function deviceItems(devices: MediaDeviceInfo[]) {
	return [
		{ label: 'По умолчанию', value: 'default' },
		...devices
			.filter((d) => d.deviceId && d.deviceId !== 'default')
			.map((d) => ({ label: d.label || 'Устройство', value: d.deviceId }))
	]
}

const micItems = computed(() => deviceItems(mics.value))
const speakerItems = computed(() => deviceItems(speakers.value))
const cameraItems = computed(() => deviceItems(cameras.value))

function prefModel(key: 'micDeviceId' | 'speakerDeviceId' | 'cameraDeviceId') {
	return computed({
		get: () => prefs.value[key] ?? 'default',
		set: (value: string) => {
			prefs.value[key] = value === 'default' ? null : value
		}
	})
}

const micId = prefModel('micDeviceId')
const speakerId = prefModel('speakerDeviceId')
const cameraId = prefModel('cameraDeviceId')

async function refreshDevices() {
	const { Room } = await import('livekit-client')
	try {
		mics.value = await Room.getLocalDevices('audioinput', true)
		speakers.value = await Room.getLocalDevices('audiooutput', false)
	} catch {
		permissionError.value = true
	}
	try {
		cameras.value = await Room.getLocalDevices('videoinput', true)
	} catch {
		// камеры может не быть — селект просто останется с «По умолчанию»
	}
}

function onDeviceChange() {
	void refreshDevices()
}

onMounted(() => {
	void refreshDevices()
	navigator.mediaDevices?.addEventListener('devicechange', onDeviceChange)
})

// apply changes to an active call, restart running tests on the new device
watch(micId, (id) => {
	void voice.setDevice('audioinput', id === 'default' ? null : id)
	if (testing.value) void restartMicTest()
})
watch(speakerId, (id) => {
	void voice.setDevice('audiooutput', id === 'default' ? null : id)
})
watch(cameraId, () => {
	if (previewing.value) void restartPreview()
})

// mic test — level meter via AnalyserNode
const testing = ref(false)
const level = ref(0)
let testStream: MediaStream | null = null
let audioContext: AudioContext | null = null
let rafId = 0

async function toggleMicTest() {
	if (testing.value) {
		stopMicTest()
		return
	}
	try {
		testStream = await navigator.mediaDevices.getUserMedia({
			audio: prefs.value.micDeviceId ? { deviceId: { exact: prefs.value.micDeviceId } } : true
		})
		audioContext = new AudioContext()
		const analyser = audioContext.createAnalyser()
		analyser.fftSize = 512
		audioContext.createMediaStreamSource(testStream).connect(analyser)
		const buffer = new Uint8Array(analyser.fftSize)
		testing.value = true
		const tick = () => {
			analyser.getByteTimeDomainData(buffer)
			let sum = 0
			for (const value of buffer) sum += (value - 128) ** 2
			const rms = Math.sqrt(sum / buffer.length) / 128
			level.value = Math.min(100, Math.round(rms * 300))
			rafId = requestAnimationFrame(tick)
		}
		tick()
	} catch {
		stopMicTest()
		toast.add({ title: 'Не удалось получить доступ к микрофону', color: 'error' })
	}
}

function stopMicTest() {
	cancelAnimationFrame(rafId)
	testStream?.getTracks().forEach((track) => track.stop())
	testStream = null
	void audioContext?.close()
	audioContext = null
	testing.value = false
	level.value = 0
}

async function restartMicTest() {
	stopMicTest()
	await toggleMicTest()
}

// camera preview
const previewing = ref(false)
const videoEl = ref<HTMLVideoElement>()
let previewStream: MediaStream | null = null

async function togglePreview() {
	if (previewing.value) {
		stopPreview()
		return
	}
	try {
		previewStream = await navigator.mediaDevices.getUserMedia({
			video: prefs.value.cameraDeviceId ? { deviceId: { exact: prefs.value.cameraDeviceId } } : true
		})
		previewing.value = true
		await nextTick()
		if (videoEl.value) videoEl.value.srcObject = previewStream
	} catch {
		stopPreview()
		toast.add({ title: 'Не удалось получить доступ к камере', color: 'error' })
	}
}

function stopPreview() {
	previewStream?.getTracks().forEach((track) => track.stop())
	previewStream = null
	if (videoEl.value) videoEl.value.srcObject = null
	previewing.value = false
}

async function restartPreview() {
	stopPreview()
	await togglePreview()
}

onUnmounted(() => {
	stopMicTest()
	stopPreview()
	navigator.mediaDevices?.removeEventListener('devicechange', onDeviceChange)
})
</script>
