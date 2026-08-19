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
					v-if="!liveLevelAvailable || ownsTest"
					:icon="ownsTest ? 'i-lucide-square' : 'i-lucide-mic'"
					:label="ownsTest ? 'Остановить проверку' : 'Проверить микрофон'"
					color="neutral"
					variant="soft"
					@click="toggleMicTest"
				/>

				<template v-if="meterVisible">
					<div class="flex items-center justify-between">
						<span class="text-muted text-xs">Уровень сигнала</span>
						<span
							v-if="liveLevelAvailable"
							class="text-xs"
							:class="gateOpen ? 'text-success' : 'text-muted'"
						>
							{{ gateOpen ? 'микрофон открыт' : 'микрофон закрыт' }}
						</span>
					</div>
					<!-- the threshold marker sits on the same bar as the level, and both are the
					     same 0–100 scale from audio-level.ts — the gate compares the very same numbers -->
					<div class="relative">
						<UProgress :model-value="meterLevel" :max="100" :color="meterColor" size="lg" />
						<div
							v-if="micMode === 'gate'"
							class="bg-inverted absolute inset-y-0 w-0.5 rounded-full"
							:style="{ left: `${gateThreshold}%` }"
						/>
					</div>
					<p class="text-muted text-xs">
						{{ meterHint }}
					</p>
				</template>
			</div>
		</section>

		<section class="space-y-4">
			<UFormField label="Режим микрофона" name="micMode">
				<URadioGroup v-model="micMode" :items="micModeItems" variant="card" />
			</UFormField>

			<div v-if="micMode === 'gate'" class="max-w-xs space-y-4">
				<UFormField :label="`Порог: ${gateThreshold}`" name="gateThreshold">
					<USlider v-model="gateThreshold" :max="100" :min="0" />
				</UFormField>
				<UFormField :label="`Задержка закрытия: ${gateHold} мс`" name="gateHold">
					<USlider v-model="gateHold" :max="1000" :min="50" :step="50" />
				</UFormField>
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
import type { MicMode, Preferences } from '~/composables/usePreferences'

const toast = useToast()
const prefs = usePreferences()
const voice = useVoice()
// device enumeration and the level meter are shared with the voice control bar's picker, so
// the two surfaces cannot drift apart on what a device list is or where a level comes from
const devices = useMediaDevices()
const mic = useMicLevel()

const permissionError = devices.denied
const micItems = devices.micItems
const speakerItems = devices.speakerItems
const cameraItems = devices.cameraItems
const speakerSupported = devices.speakerSupported
// whether *this* panel started the test, not merely whether a stream is open: the picker may
// be holding one, and offering «Остановить проверку» for somebody else's capture would give
// this panel a button whose click does nothing
const ownsTest = mic.ownsTest

// the watcher in useVoice applies these to the live room; this panel only records the choice,
// exactly like the control-bar picker does, and through the same sentinel translation
const micId = devices.deviceModel('micDeviceId')
const speakerId = devices.deviceModel('speakerDeviceId')
const cameraId = devices.deviceModel('cameraDeviceId')

// mic transmission mode + gate tuning
function prefRef<K extends keyof Preferences>(key: K) {
	return computed({
		get: () => prefs.value[key],
		set: (value: Preferences[K]) => {
			prefs.value[key] = value
		}
	})
}

const micMode = prefRef('micMode')
const gateThreshold = prefRef('gateThreshold')
const gateHold = prefRef('gateHold')

const micModeItems: { value: MicMode; label: string; description: string }[] = [
	{
		value: 'open',
		label: 'Открытый микрофон',
		description: 'Вас слышно всегда, пока микрофон не выключен'
	},
	{
		value: 'gate',
		label: 'Шумовой порог',
		description:
			'Микрофон открывается только когда вы говорите — клавиатура и вентилятор не проходят'
	}
]

// While a gate is attached the meter shows the real signal running through it; otherwise it
// falls back to the separate test stream. `useMicLevel` picks between the two and hands the
// test off when a gate appears, so this panel only has to say what to draw.
const liveLevelAvailable = mic.liveLevelAvailable
const gateOpen = computed(() => voice.micGateOpen.value)
// in gate mode the bar is shown even with nothing to measure: the marker is the thing being
// dragged, and the hint below it is what explains where to go to tune against a real signal
const meterVisible = computed(() => mic.hasSignal.value || micMode.value === 'gate')
const meterLevel = mic.level
const meterColor = computed(() =>
	micMode.value === 'gate' && meterLevel.value < gateThreshold.value ? 'neutral' : 'success'
)
const meterHint = computed(() => {
	if (micMode.value !== 'gate') return 'Скажите что-нибудь — индикатор должен реагировать на голос.'
	return liveLevelAvailable.value
		? 'Порог — вертикальная черта. Голос должен уверенно её перешагивать, а шум — нет.'
		: 'Порог — вертикальная черта. Зайдите в голосовой канал, чтобы настроить его по живому сигналу.'
})

onMounted(() => {
	// this panel asks for permission up front: it exists to configure devices, so an unlabelled
	// list would make it useless. The control-bar picker deliberately does not.
	void devices.refresh({ requestPermissions: true })
	devices.startListening()
	mic.startMonitoring()
})
// both composables release what this component took in their own onScopeDispose

async function toggleMicTest() {
	if (ownsTest.value) {
		mic.stopTest()
		return
	}
	if (!(await mic.startTest())) {
		toast.add({ title: 'Не удалось получить доступ к микрофону', color: 'error' })
	}
}

// camera preview
const previewing = ref(false)
const videoEl = ref<HTMLVideoElement>()
let previewStream: MediaStream | null = null

watch(cameraId, () => {
	if (previewing.value) void restartPreview()
})

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
	stopPreview()
})
</script>
