<template>
	<UModal
		:close="{ onClick: () => emit('close', false) }"
		:description="description"
		:title="title"
		:ui="{ footer: 'justify-end' }"
	>
		<template #footer>
			<UButton color="neutral" label="Отмена" variant="outline" @click="emit('close', false)" />
			<UButton :label="confirmLabel ?? 'Удалить'" color="error" @click="emit('close', true)" />
		</template>
	</UModal>
</template>

<script lang="ts" setup>
defineProps<{
	title: string
	description?: string
	confirmLabel?: string
}>()

const emit = defineEmits<{ close: [boolean] }>()
</script>
