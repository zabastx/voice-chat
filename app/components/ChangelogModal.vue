<template>
	<UModal :close="{ onClick: () => emit('close') }" title="Что нового">
		<template #body>
			<ChangelogList />
		</template>

		<template #footer>
			<p class="text-dimmed w-full text-center text-xs">Текущая версия: {{ currentVersion }}</p>
		</template>
	</UModal>
</template>

<script lang="ts" setup>
const emit = defineEmits<{ close: [] }>()

const { currentVersion } = useChangelog()
</script>
