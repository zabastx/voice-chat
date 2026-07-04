<template>
	<div class="flex w-full items-center gap-2">
		<UChip :color="connected ? 'success' : 'neutral'" inset position="bottom-right">
			<UAvatar :alt="displayName" :src="self?.avatarUrl ?? undefined" size="sm" />
		</UChip>
		<div class="min-w-0 flex-1">
			<p class="text-highlighted truncate text-sm font-medium">{{ displayName }}</p>
			<p class="text-muted text-xs">{{ connected ? 'в сети' : 'подключение…' }}</p>
		</div>
		<UTooltip v-if="canModerate" text="Приглашения и участники">
			<UButton
				color="neutral"
				icon="i-lucide-users"
				size="sm"
				variant="ghost"
				@click="openManage"
			/>
		</UTooltip>
		<UTooltip text="Настройки">
			<UButton
				color="neutral"
				icon="i-lucide-settings"
				size="sm"
				variant="ghost"
				@click="openSettings"
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
import SettingsModal from './SettingsModal.vue'

const { user, clear } = useUserSession()
const { canModerate } = useRole()
const { connected, stop } = useRealtime()
const membersStore = useMembersStore()

const self = computed(() => membersStore.profile(user.value?.id))
const displayName = computed(() => self.value?.displayName ?? user.value?.username)

const overlay = useOverlay()
const manageModal = overlay.create(ManageModal)
const settingsModal = overlay.create(SettingsModal)

function openManage() {
	manageModal.open()
}

function openSettings() {
	settingsModal.open()
}

async function logout() {
	stop()
	await clear()
	await navigateTo('/login')
}
</script>
