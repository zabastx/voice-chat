<template>
	<UDashboardSidebar
		id="members"
		v-model:open="membersOpen"
		:default-size="16"
		:menu="{ side: 'right' }"
		:min-size="14"
		side="right"
		toggle-side="right"
		:ui="{ root: membersHidden ? 'lg:hidden' : '' }"
	>
		<!-- built-in toggle fires a group-wide hook that opens BOTH sidebars; replace it.
		     toggleSide 'right' puts the close X where the navbar button opened it. -->
		<template #toggle="{ toggle }">
			<UButton
				aria-label="Закрыть"
				color="neutral"
				icon="i-lucide-x"
				variant="ghost"
				@click="() => toggle()"
			/>
		</template>

		<template #header>
			<div class="flex w-full items-center justify-between gap-2">
				<span class="text-highlighted truncate font-semibold">Участники</span>
				<!-- ClientOnly: showOfflineMembers comes from localStorage, so the
				     icon/tooltip can't be known during SSR (would mismatch on hydration) -->
				<ClientOnly>
					<UTooltip :text="prefs.showOfflineMembers ? 'Скрыть не в сети' : 'Показать не в сети'">
						<UButton
							:aria-label="prefs.showOfflineMembers ? 'Скрыть не в сети' : 'Показать не в сети'"
							color="neutral"
							:icon="prefs.showOfflineMembers ? 'i-lucide-eye' : 'i-lucide-eye-off'"
							size="xs"
							variant="ghost"
							@click="toggleOffline"
						/>
					</UTooltip>
					<template #fallback>
						<UButton color="neutral" disabled icon="i-lucide-eye-off" size="xs" variant="ghost" />
					</template>
				</ClientOnly>
			</div>
		</template>

		<div class="flex flex-col gap-4">
			<section v-if="onlineMembers.length">
				<p class="text-dimmed px-2 pb-1 text-xs font-semibold uppercase">
					В сети — {{ onlineMembers.length }}
				</p>
				<UDropdownMenu
					v-for="member in onlineMembers"
					:key="member.id"
					:disabled="member.id === user?.id"
					:items="memberMenu(member)"
				>
					<button
						class="hover:bg-elevated flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm"
						type="button"
					>
						<UChip color="success" inset position="bottom-right">
							<UAvatar :alt="name(member)" size="2xs" :src="member.avatarUrl ?? undefined" />
						</UChip>
						<span class="text-muted truncate">{{ name(member) }}</span>
					</button>
				</UDropdownMenu>
			</section>

			<!-- ClientOnly: the pref comes from localStorage, so SSR can't know it -->
			<ClientOnly>
				<section v-if="prefs.showOfflineMembers && offlineMembers.length">
					<p class="text-dimmed px-2 pb-1 text-xs font-semibold uppercase">
						Не в сети — {{ offlineMembers.length }}
					</p>
					<UDropdownMenu
						v-for="member in offlineMembers"
						:key="member.id"
						:disabled="member.id === user?.id"
						:items="memberMenu(member)"
					>
						<button
							class="hover:bg-elevated flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm opacity-60"
							type="button"
						>
							<UAvatar :alt="name(member)" size="2xs" :src="member.avatarUrl ?? undefined" />
							<span class="text-muted truncate">{{ name(member) }}</span>
						</button>
					</UDropdownMenu>
				</section>
			</ClientOnly>
		</div>
	</UDashboardSidebar>
</template>

<script lang="ts" setup>
import type { DropdownMenuItem } from '@nuxt/ui'

const membersStore = useMembersStore()
const dm = useDmStore()
const { online } = useRealtime()
const { user } = useUserSession()
const prefs = usePreferences()
const { membersOpen, membersHidden } = usePanels()
const toast = useToast()

const name = (m: MemberDto) => m.displayName ?? m.username

function memberMenu(member: MemberDto): DropdownMenuItem[][] {
	if (member.id === user.value?.id) return []
	return [
		[
			{
				label: 'Написать',
				icon: 'i-lucide-message-square',
				onSelect: async () => {
					try {
						await dm.openDm(member.id)
					} catch {
						toast.add({ title: 'Не удалось открыть диалог', color: 'error' })
					}
				}
			}
		]
	]
}
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
