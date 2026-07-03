<template>
	<UDashboardSidebar id="members" collapsible :default-size="16" :min-size="14" side="right">
		<template #header>
			<div class="flex w-full items-center justify-between gap-2">
				<span class="text-highlighted truncate font-semibold">Участники</span>
				<UTooltip :text="prefs.showOfflineMembers ? 'Скрыть не в сети' : 'Показать не в сети'">
					<UButton
						color="neutral"
						:icon="prefs.showOfflineMembers ? 'i-lucide-eye' : 'i-lucide-eye-off'"
						size="xs"
						variant="ghost"
						@click="toggleOffline"
					/>
				</UTooltip>
			</div>
		</template>

		<div class="flex flex-col gap-4">
			<section v-if="onlineMembers.length">
				<p class="text-dimmed px-2 pb-1 text-xs font-semibold uppercase">
					В сети — {{ onlineMembers.length }}
				</p>
				<div
					v-for="member in onlineMembers"
					:key="member.id"
					class="flex items-center gap-2 rounded-md px-2 py-1 text-sm"
				>
					<UChip color="success" inset position="bottom-right">
						<UAvatar :alt="name(member)" size="2xs" :src="member.avatarUrl ?? undefined" />
					</UChip>
					<span class="text-muted truncate">{{ name(member) }}</span>
				</div>
			</section>

			<!-- ClientOnly: the pref comes from localStorage, so SSR can't know it -->
			<ClientOnly>
				<section v-if="prefs.showOfflineMembers && offlineMembers.length">
					<p class="text-dimmed px-2 pb-1 text-xs font-semibold uppercase">
						Не в сети — {{ offlineMembers.length }}
					</p>
					<div
						v-for="member in offlineMembers"
						:key="member.id"
						class="flex items-center gap-2 rounded-md px-2 py-1 text-sm opacity-60"
					>
						<UAvatar :alt="name(member)" size="2xs" :src="member.avatarUrl ?? undefined" />
						<span class="text-muted truncate">{{ name(member) }}</span>
					</div>
				</section>
			</ClientOnly>
		</div>
	</UDashboardSidebar>
</template>

<script lang="ts" setup>
const membersStore = useMembersStore()
const { online } = useRealtime()
const prefs = usePreferences()

const name = (m: MemberDto) => m.displayName ?? m.username
const sorted = computed(() =>
	Object.values(membersStore.members.value).sort((a, b) => name(a).localeCompare(name(b), 'ru'))
)
const onlineSet = computed(() => new Set(online.value))
const onlineMembers = computed(() => sorted.value.filter((m) => onlineSet.value.has(m.id)))
const offlineMembers = computed(() => sorted.value.filter((m) => !onlineSet.value.has(m.id)))

function toggleOffline() {
	prefs.value.showOfflineMembers = !prefs.value.showOfflineMembers
}
</script>
