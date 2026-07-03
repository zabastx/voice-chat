<template>
	<UModal fullscreen>
		<template #content>
			<div class="flex h-full w-full flex-col sm:flex-row">
				<!-- Category list: full screen on mobile, fixed sidebar on desktop.
				     Hidden on mobile once a category is opened (detail view takes over). -->
				<aside
					class="border-default bg-elevated/50 flex-1 flex-col gap-0.5 border-b p-3 sm:w-56 sm:flex-none sm:border-r sm:border-b-0"
					:class="mobileDetail ? 'hidden sm:flex' : 'flex'"
				>
					<div class="flex items-center justify-between gap-2 px-2.5 pb-1.5">
						<p class="text-muted text-xs font-semibold uppercase">Настройки</p>
						<UButton
							class="sm:hidden"
							color="neutral"
							icon="i-lucide-x"
							size="xs"
							square
							variant="ghost"
							@click="emit('close')"
						/>
					</div>
					<UButton
						v-for="tab in tabs"
						:key="tab.id"
						:icon="tab.icon"
						:label="tab.label"
						:variant="active === tab.id ? 'soft' : 'ghost'"
						color="neutral"
						@click="() => select(tab.id)"
					>
						<template #trailing>
							<UIcon name="i-lucide-chevron-right" class="text-dimmed ms-auto size-4 sm:hidden" />
						</template>
					</UButton>
				</aside>

				<!-- Detail: hidden on mobile until a category is picked; always shown on desktop. -->
				<div class="relative flex-1 flex-col" :class="mobileDetail ? 'flex' : 'hidden sm:flex'">
					<!-- Mobile header with back navigation -->
					<div class="border-default flex shrink-0 items-center gap-2 border-b p-3 sm:hidden">
						<UButton
							aria-label="Назад"
							color="neutral"
							icon="i-lucide-arrow-left"
							square
							variant="ghost"
							@click="back"
						/>
						<span class="text-highlighted font-semibold">{{ activeTab.label }}</span>
						<UButton
							aria-label="Закрыть"
							class="ms-auto"
							color="neutral"
							icon="i-lucide-x"
							square
							variant="ghost"
							@click="emit('close')"
						/>
					</div>

					<!-- Desktop close -->
					<div class="absolute top-4 right-4 z-10 hidden flex-col items-center gap-1 sm:flex">
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

					<div class="flex-1 overflow-y-auto">
						<div class="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10">
							<SettingsProfile v-if="active === 'profile'" />
							<SettingsVoice v-else-if="active === 'voice'" />
							<SettingsNotifications v-else />
						</div>
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

type TabId = (typeof tabs)[number]['id']

const active = ref<TabId>('profile')
// mobile only: false = category list, true = the selected category's settings
const mobileDetail = ref(false)

const activeTab = computed(() => tabs.find((t) => t.id === active.value)!)

function select(id: TabId) {
	active.value = id
	mobileDetail.value = true
}

function back() {
	mobileDetail.value = false
}
</script>
