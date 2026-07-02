<template>
	<UModal
		:close="{ onClick: () => emit('close') }"
		:ui="{ content: 'max-w-2xl' }"
		title="Приглашения и участники"
	>
		<template #body>
			<UTabs
				:items="[
					{ label: 'Приглашения', icon: 'i-lucide-ticket', slot: 'invites' },
					{ label: 'Участники', icon: 'i-lucide-users', slot: 'members' }
				]"
				color="neutral"
			>
				<template #invites>
					<div class="space-y-4 pt-2">
						<UButton
							:loading="creating"
							icon="i-lucide-plus"
							label="Новая ссылка-приглашение"
							@click="createInvite"
						/>
						<p v-if="!invites?.length" class="text-muted text-sm">
							Приглашений пока нет. Создайте ссылку и отправьте другу — она сработает один раз.
						</p>
						<ul v-else class="divide-default divide-y">
							<li
								v-for="invite in invites"
								:key="invite.token"
								class="flex items-center gap-3 py-2"
							>
								<UIcon
									:class="invite.usedAt ? 'text-dimmed' : 'text-success'"
									class="size-4 shrink-0"
									name="i-lucide-ticket"
								/>
								<div class="min-w-0 flex-1">
									<p class="text-default truncate font-mono text-xs">{{ invite.token }}</p>
									<p class="text-muted text-xs">
										{{ invite.usedAt ? `Использовано: ${invite.usedByName}` : 'Не использовано' }}
									</p>
								</div>
								<UTooltip v-if="!invite.usedAt" text="Скопировать ссылку">
									<UButton
										color="neutral"
										icon="i-lucide-copy"
										size="xs"
										variant="ghost"
										@click="copyInvite(invite.token)"
									/>
								</UTooltip>
								<UTooltip v-if="!invite.usedAt" text="Отозвать">
									<UButton
										color="error"
										icon="i-lucide-trash-2"
										size="xs"
										variant="ghost"
										@click="revokeInvite(invite.token)"
									/>
								</UTooltip>
							</li>
						</ul>
					</div>
				</template>

				<template #members>
					<ul class="divide-default divide-y pt-2">
						<li v-for="member in members" :key="member.id" class="flex items-center gap-3 py-2">
							<UChip
								:color="online.includes(member.id) ? 'success' : 'neutral'"
								inset
								position="bottom-right"
							>
								<UAvatar :alt="member.username" size="sm" />
							</UChip>
							<div class="min-w-0 flex-1">
								<p class="text-default flex items-center gap-1.5 truncate text-sm font-medium">
									{{ member.username }}
									<UBadge v-if="member.isAdmin" color="primary" size="sm" variant="subtle">
										админ
									</UBadge>
								</p>
								<p class="text-muted text-xs">
									{{ online.includes(member.id) ? 'в сети' : 'не в сети' }}
								</p>
							</div>
							<template v-if="resettingId === member.id">
								<UInput
									v-model="newPassword"
									class="w-40"
									placeholder="Новый пароль"
									size="sm"
									type="password"
									@keydown.enter="savePassword(member.id)"
								/>
								<UButton
									icon="i-lucide-check"
									size="xs"
									variant="soft"
									@click="savePassword(member.id)"
								/>
								<UButton
									color="neutral"
									icon="i-lucide-x"
									size="xs"
									variant="ghost"
									@click="cancelReset"
								/>
							</template>
							<template v-else-if="member.id !== user?.id">
								<UTooltip text="Сбросить пароль">
									<UButton
										color="neutral"
										icon="i-lucide-key-round"
										size="xs"
										variant="ghost"
										@click="startReset(member.id)"
									/>
								</UTooltip>
								<UTooltip text="Удалить участника">
									<UButton
										color="error"
										icon="i-lucide-user-x"
										size="xs"
										variant="ghost"
										@click="deleteMember(member)"
									/>
								</UTooltip>
							</template>
						</li>
					</ul>
				</template>
			</UTabs>
		</template>
	</UModal>
</template>

<script lang="ts" setup>
import ConfirmModal from './ConfirmModal.vue'

const emit = defineEmits<{ close: [] }>()

const toast = useToast()
const { user } = useUserSession()
const { online } = useRealtime()

const overlay = useOverlay()
const confirmModal = overlay.create(ConfirmModal)

const { data: invites, refresh: refreshInvites } = useFetch('/api/invites', { server: false })
const { data: members, refresh: refreshMembers } = useFetch('/api/members', { server: false })

const creating = ref(false)
const resettingId = ref<string | null>(null)
const newPassword = ref('')

async function createInvite() {
	creating.value = true
	try {
		const { token } = await $fetch('/api/invites', { method: 'POST' })
		await copyInvite(token)
		await refreshInvites()
	} finally {
		creating.value = false
	}
}

async function copyInvite(token: string) {
	await navigator.clipboard.writeText(`${location.origin}/register?invite=${token}`)
	toast.add({
		title: 'Ссылка-приглашение скопирована',
		icon: 'i-lucide-clipboard-check',
		color: 'success'
	})
}

async function revokeInvite(token: string) {
	await $fetch(`/api/invites/${token}`, { method: 'DELETE' })
	await refreshInvites()
}

function startReset(memberId: string) {
	resettingId.value = memberId
	newPassword.value = ''
}

function cancelReset() {
	resettingId.value = null
}

async function savePassword(memberId: string) {
	try {
		await $fetch(`/api/members/${memberId}/password`, {
			method: 'POST',
			body: { password: newPassword.value }
		})
		toast.add({ title: 'Пароль обновлён', color: 'success' })
		resettingId.value = null
	} catch (e) {
		toast.add({
			title: (e as { data?: { message?: string } }).data?.message ?? 'Не удалось изменить пароль',
			color: 'error'
		})
	}
}

async function deleteMember(member: { id: string; username: string }) {
	const instance = confirmModal.open({
		title: `Удалить ${member.username}?`,
		description: 'Аккаунт и все сообщения этого участника будут удалены.',
		confirmLabel: 'Удалить'
	})
	if (!(await instance.result)) return
	await $fetch(`/api/members/${member.id}`, { method: 'DELETE' })
	await refreshMembers()
}
</script>
