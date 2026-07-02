<template>
	<div class="flex w-full items-center gap-2">
		<UChip :color="connected ? 'success' : 'neutral'" inset position="bottom-right">
			<UAvatar :alt="user?.username" size="sm" />
		</UChip>
		<div class="min-w-0 flex-1">
			<p class="text-highlighted truncate text-sm font-medium">{{ user?.username }}</p>
			<p class="text-muted text-xs">{{ connected ? 'в сети' : 'подключение…' }}</p>
		</div>
		<UTooltip v-if="user?.isAdmin" text="Приглашения и участники">
			<UButton
				color="neutral"
				icon="i-lucide-settings"
				size="sm"
				variant="ghost"
				@click="openManage"
			/>
		</UTooltip>
		<UColorModeButton size="sm" />
		<UTooltip text="Выйти">
			<UButton color="neutral" icon="i-lucide-log-out" size="sm" variant="ghost" @click="logout" />
		</UTooltip>
	</div>
</template>

<script lang="ts" setup>
import ManageModal from './ManageModal.vue'

const { user, clear } = useUserSession()
const { connected, stop } = useRealtime()

const overlay = useOverlay()
const manageModal = overlay.create(ManageModal)

function openManage() {
	manageModal.open()
}

async function logout() {
	stop()
	await clear()
	await navigateTo('/login')
}
</script>
