<template>
	<UButton
		aria-label="Открыть каналы"
		class="lg:hidden"
		color="neutral"
		icon="i-lucide-menu"
		variant="ghost"
		@click="openMenu"
	/>
	<UButton
		:aria-label="channelsHidden ? 'Показать панель каналов' : 'Скрыть панель каналов'"
		class="hidden lg:inline-flex"
		color="neutral"
		:icon="channelsHidden ? 'i-lucide-panel-left-open' : 'i-lucide-panel-left-close'"
		variant="ghost"
		@click="toggleHidden"
	/>
</template>

<script lang="ts" setup>
const { channelsOpen, channelsHidden } = usePanels()

function openMenu() {
	channelsOpen.value = true
}

function toggleHidden() {
	channelsHidden.value = !channelsHidden.value
}
</script>
