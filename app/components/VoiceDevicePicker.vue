<template>
	<UPopover v-model:open="open" :content="{ align: 'center', side: 'top' }">
		<UTooltip text="Устройства">
			<UButton
				aria-label="Устройства"
				color="neutral"
				icon="i-lucide-settings-2"
				size="lg"
				variant="soft"
			/>
		</UTooltip>

		<template #content>
			<div class="w-72 space-y-4 p-3">
				<UAlert
					v-if="devices.denied.value"
					color="warning"
					description="Разрешите доступ в настройках браузера и обновите страницу."
					icon="i-lucide-mic-off"
					title="Нет доступа к устройствам"
					variant="subtle"
				/>

				<!--
					Enumerating without a grant yields label-less placeholders, so this button is
					how the member turns «Устройство ×4» into a real list. Deliberately explicit:
					opening a dropdown should never be what fires a permission prompt.
				-->
				<div v-else-if="devices.needsPermission.value" class="space-y-2">
					<p class="text-muted text-xs">
						Разрешите доступ к микрофону, чтобы увидеть названия устройств.
					</p>
					<UButton
						block
						color="neutral"
						icon="i-lucide-mic"
						label="Разрешить доступ"
						size="sm"
						variant="soft"
						@click="grant"
					/>
				</div>

				<section class="space-y-1.5">
					<UFormField label="Микрофон" name="pickerMic" size="sm">
						<USelect v-model="micId" :items="devices.micItems.value" class="w-full" size="sm" />
					</UFormField>
					<!--
						The bar answers exactly one question — «этот микрофон вообще работает?».
						Threshold tuning stays in the settings panel; this is not a second one.
					-->
					<UProgress
						v-if="mic.hasSignal.value"
						:max="100"
						:model-value="mic.level.value"
						size="sm"
					/>
				</section>

				<section class="space-y-1">
					<UFormField label="Динамики" name="pickerSpeaker" size="sm">
						<USelect
							v-model="speakerId"
							:disabled="!devices.speakerSupported"
							:items="devices.speakerItems.value"
							class="w-full"
							size="sm"
						/>
					</UFormField>
					<p v-if="!devices.speakerSupported" class="text-muted text-xs">
						Этот браузер не умеет выбирать устройство вывода.
					</p>
				</section>

				<section>
					<UFormField label="Камера" name="pickerCamera" size="sm">
						<USelect
							v-model="cameraId"
							:items="devices.cameraItems.value"
							class="w-full"
							size="sm"
						/>
					</UFormField>
				</section>

				<USeparator />

				<UButton
					block
					color="neutral"
					icon="i-lucide-sliders-horizontal"
					label="Все настройки звука"
					size="sm"
					variant="ghost"
					@click="openSettings"
				/>
			</div>
		</template>
	</UPopover>
</template>

<script lang="ts" setup>
import SettingsModal from './SettingsModal.vue'

const devices = useMediaDevices()
const mic = useMicLevel()

const overlay = useOverlay()
const settingsModal = overlay.create(SettingsModal)

const open = ref(false)

// the «По умолчанию» ↔ null translation lives in useMediaDevices, so this picker and the
// settings panel cannot come to disagree about what the sentinel means (gotcha 6)
const micId = devices.deviceModel('micDeviceId')
const speakerId = devices.deviceModel('speakerDeviceId')
const cameraId = devices.deviceModel('cameraDeviceId')

// The popover is short-lived and deliberately opened — that is exactly the moment a meter
// earns its cost — so it starts on open and stops on close. `startTest` is a no-op while the
// gate is feeding the meter, and is skipped entirely before a permission grant so that
// opening the popover never prompts.
watch(open, async (isOpen) => {
	if (!isOpen) {
		mic.stopMonitoring()
		mic.stopTest()
		devices.stopListening()
		return
	}
	mic.startMonitoring()
	devices.startListening()
	// awaited: before the first enumeration resolves the list is empty, which `needsPermission`
	// cannot tell apart from a genuine refusal — checking it too early skips the meter every
	// first open and shows a grant button nobody needs
	await devices.refresh()
	if (!open.value) return
	// a refused second capture just means no bar; the microphone itself is fine and saying
	// otherwise would be a scary toast about nothing
	if (!devices.needsPermission.value) void mic.startTest()
})

async function grant() {
	await devices.refresh({ requestPermissions: true })
	if (!devices.needsPermission.value) void mic.startTest()
}

function openSettings() {
	open.value = false
	settingsModal.open({ tab: 'voice' })
}
</script>
