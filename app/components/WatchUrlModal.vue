<template>
	<UModal
		:close="{ onClick: () => emit('close', undefined) }"
		:ui="{ footer: 'justify-end' }"
		title="Смотреть вместе"
	>
		<template #body>
			<UFormField
				:error="error"
				hint="Видео, Shorts или трансляция"
				label="Ссылка на YouTube"
				name="url"
			>
				<UInput
					v-model="url"
					autofocus
					class="w-full"
					placeholder="https://www.youtube.com/watch?v=..."
					@keydown.enter="submit"
				/>
			</UFormField>
			<p class="text-muted mt-3 text-xs">
				Видео проигрывается у каждого на своём устройстве — качество и субтитры каждый выбирает сам.
				Ставить на паузу и перематывать может любой в канале.
			</p>
		</template>
		<template #footer>
			<UButton color="neutral" label="Отмена" variant="outline" @click="emit('close', undefined)" />
			<UButton color="primary" icon="i-lucide-tv" label="Включить" @click="submit" />
		</template>
	</UModal>
</template>

<script lang="ts" setup>
const emit = defineEmits<{ close: [string | undefined] }>()

const url = ref('')
const error = ref<string | undefined>()

// validate with the same parser the server uses, so an unusable link is
// rejected here instead of round-tripping for the identical message
function submit() {
	const value = url.value.trim()
	if (!value) {
		error.value = 'Введите ссылку'
		return
	}
	if (!parseWatchUrl(value)) {
		error.value = 'Не похоже на ссылку YouTube'
		return
	}
	emit('close', value)
}

watch(url, () => {
	error.value = undefined
})
</script>
