<template>
	<UButton
		aria-label="Открыть список участников"
		class="lg:hidden"
		color="neutral"
		icon="i-lucide-users"
		variant="ghost"
		@click="openMenu"
	/>
	<UTooltip :text="membersHidden ? 'Показать участников' : 'Скрыть участников'">
		<UButton
			:aria-label="membersHidden ? 'Показать участников' : 'Скрыть участников'"
			class="hidden lg:inline-flex"
			color="neutral"
			icon="i-lucide-users"
			:variant="membersHidden ? 'ghost' : 'soft'"
			@click="toggleHidden"
		/>
	</UTooltip>
</template>

<script lang="ts" setup>
const { membersOpen, membersHidden } = usePanels()

function openMenu() {
	membersOpen.value = true
}

function toggleHidden() {
	membersHidden.value = !membersHidden.value
}
</script>
