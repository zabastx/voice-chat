<template>
	<UDashboardPanel id="welcome">
		<template #header>
			<UDashboardNavbar title="Добро пожаловать" :toggle="false">
				<template #leading>
					<SidebarToggle />
				</template>
				<template #right>
					<MembersToggle />
				</template>
			</UDashboardNavbar>
		</template>
		<template #body>
			<div class="flex flex-1 flex-col items-center justify-center gap-3 text-center">
				<UIcon class="text-dimmed size-10" name="i-lucide-messages-square" />
				<p class="text-muted">Текстовых каналов пока нет.</p>
				<p v-if="canModerate" class="text-dimmed text-sm">
					Создайте канал кнопкой «+» в боковой панели.
				</p>
			</div>
		</template>
	</UDashboardPanel>
</template>

<script lang="ts" setup>
const { canModerate } = useRole()
const store = useChannelsStore()

const firstText = computed(() => store.textChannels.value[0])

if (firstText.value) {
	await navigateTo(`/channels/${firstText.value.id}`, { replace: true })
}

watch(firstText, (channel) => {
	if (channel) navigateTo(`/channels/${channel.id}`, { replace: true })
})
</script>
