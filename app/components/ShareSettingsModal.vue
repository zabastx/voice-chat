<template>
	<UModal
		:close="{ onClick: () => emit('close', undefined) }"
		:ui="{ footer: 'justify-end' }"
		title="Демонстрация экрана"
	>
		<template #body>
			<UFormField label="Качество" name="preset">
				<USelect
					v-model="workingPreset"
					:items="presetItems"
					class="w-full max-w-xs"
					value-key="value"
				/>
				<p class="text-muted mt-2 text-xs">
					{{ selectedItem?.hint }}
				</p>
			</UFormField>
		</template>
		<template #footer>
			<UButton color="neutral" label="Отмена" variant="outline" @click="emit('close', undefined)" />
			<UButton
				color="primary"
				icon="i-lucide-monitor-up"
				label="Начать"
				@click="emit('close', workingPreset)"
			/>
		</template>
	</UModal>
</template>

<script lang="ts" setup>
import type { ScreenSharePresetId } from '~/composables/usePreferences'

const props = defineProps<{ preset: ScreenSharePresetId }>()

const emit = defineEmits<{ close: [ScreenSharePresetId | undefined] }>()

// local working copy; only committed on «Начать», discarded on cancel
const workingPreset = ref<ScreenSharePresetId>(props.preset)

const presetItems = [
	{
		value: 'h1080fps15',
		label: 'Текст и презентации',
		hint: '1920×1080, 15 кадров/с — для статичного контента'
	},
	{ value: 'h1080fps30', label: 'Видео и игры', hint: '1920×1080, 30 кадров/с — плавное движение' },
	{
		value: 'original',
		label: 'Без сжатия',
		hint: 'Нативное разрешение экрана, выгодно для точной графики'
	}
]

const selectedItem = computed(() => presetItems.find((i) => i.value === workingPreset.value))
</script>
