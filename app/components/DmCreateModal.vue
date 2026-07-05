<template>
	<UModal :close="{ onClick: () => emit('close') }" title="Новое сообщение">
		<template #body>
			<UInput
				v-model="query"
				autofocus
				class="mb-3 w-full"
				icon="i-lucide-search"
				placeholder="Поиск участников"
			/>
			<div class="flex max-h-80 flex-col gap-0.5 overflow-y-auto">
				<button
					v-for="member in filtered"
					:key="member.id"
					class="hover:bg-elevated flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
					type="button"
					@click="() => select(member.id)"
				>
					<UAvatar :alt="name(member)" size="2xs" :src="member.avatarUrl ?? undefined" />
					<span class="text-default truncate">{{ name(member) }}</span>
				</button>
				<p v-if="!filtered.length" class="text-muted px-2 py-4 text-center text-sm">
					Никого не найдено
				</p>
			</div>
		</template>
	</UModal>
</template>

<script lang="ts" setup>
const emit = defineEmits<{ close: [] }>()

const membersStore = useMembersStore()
const dm = useDmStore()
const { user } = useUserSession()
const toast = useToast()

const query = ref('')
const name = (m: MemberDto) => m.displayName ?? m.username

const filtered = computed(() => {
	const q = query.value.trim().toLowerCase()
	return Object.values(membersStore.members.value)
		.filter((m) => m.id !== user.value?.id)
		.filter((m) => !q || name(m).toLowerCase().includes(q) || m.username.toLowerCase().includes(q))
		.sort((a, b) => name(a).localeCompare(name(b), 'ru'))
})

async function select(memberId: string) {
	emit('close')
	try {
		await dm.openDm(memberId)
	} catch {
		toast.add({ title: 'Не удалось открыть диалог', color: 'error' })
	}
}
</script>
