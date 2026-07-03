<template>
	<UModal
		v-model:open="open"
		:description="`${filename} — полный размер`"
		:title="filename"
		:ui="{ content: 'max-w-4xl', body: 'flex items-center justify-center p-2 sm:p-2' }"
	>
		<template #body>
			<img :alt="filename" :src="src" class="max-h-[80vh] max-w-full rounded-md object-contain" />
		</template>
	</UModal>
</template>

<script lang="ts" setup>
const open = defineModel<boolean>('open', { default: false })

defineProps<{ src: string; filename: string }>()
</script>
