<template>
	<UModal fullscreen>
		<template #content>
			<div class="flex h-full w-full">
				<aside
					class="border-default bg-elevated/50 flex w-56 shrink-0 flex-col gap-0.5 border-r p-3"
				>
					<p class="text-muted px-2.5 pb-1.5 text-xs font-semibold uppercase">Настройки</p>
					<UButton
						v-for="tab in tabs"
						:key="tab.id"
						:icon="tab.icon"
						:label="tab.label"
						:variant="active === tab.id ? 'soft' : 'ghost'"
						color="neutral"
						@click="
							() => {
								active = tab.id
							}
						"
					/>
				</aside>

				<div class="relative flex-1 overflow-y-auto">
					<div class="absolute top-4 right-4 flex flex-col items-center gap-1">
						<UButton
							color="neutral"
							icon="i-lucide-x"
							size="sm"
							square
							variant="outline"
							@click="emit('close')"
						/>
						<span class="text-dimmed text-[10px] font-semibold">ESC</span>
					</div>

					<div class="mx-auto max-w-2xl px-6 py-10">
						<SettingsProfile v-if="active === 'profile'" />
						<SettingsVoice v-else-if="active === 'voice'" />
						<SettingsNotifications v-else />
					</div>
				</div>
			</div>
		</template>
	</UModal>
</template>

<script lang="ts" setup>
import SettingsNotifications from './settings/SettingsNotifications.vue'
import SettingsProfile from './settings/SettingsProfile.vue'
import SettingsVoice from './settings/SettingsVoice.vue'

const emit = defineEmits<{ close: [] }>()

const tabs = [
	{ id: 'profile', label: 'Профиль', icon: 'i-lucide-user' },
	{ id: 'voice', label: 'Голос и видео', icon: 'i-lucide-mic' },
	{ id: 'notifications', label: 'Уведомления', icon: 'i-lucide-bell' }
] as const

const active = ref<(typeof tabs)[number]['id']>('profile')
</script>
