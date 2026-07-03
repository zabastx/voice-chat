<template>
	<UDashboardPanel id="chat" :ui="{ root: 'h-svh min-h-0' }">
		<template #header>
			<UDashboardNavbar :title="channel ? `#${channel.name}` : ''" icon="i-lucide-hash">
				<template #leading>
					<UDashboardSidebarCollapse />
				</template>
				<template #right>
					<UDashboardSidebarCollapse side="right" />
				</template>
			</UDashboardNavbar>
		</template>

		<div
			ref="scroller"
			class="min-h-0 flex-1 overflow-y-auto scroll-smooth px-2 py-3"
			@scroll.passive="onScroll"
		>
			<div v-if="loadingOlder" class="flex justify-center py-2">
				<UIcon class="text-muted size-4 animate-spin" name="i-lucide-loader-2" />
			</div>
			<p v-else-if="!hasMore && messages.length" class="text-dimmed px-4 py-2 text-xs">
				Это начало канала #{{ channel?.name }}.
			</p>
			<div
				v-if="!messages.length && !loading"
				class="flex h-full flex-col items-center justify-center gap-2 text-center"
			>
				<UIcon class="text-dimmed size-10" name="i-lucide-message-circle-dashed" />
				<p class="text-muted text-sm">Пока пусто. Напишите что-нибудь!</p>
			</div>

			<template v-for="(message, i) in messages" :key="message.id">
				<USeparator
					v-if="i > 0 && !sameDay(messages[i - 1]!.createdAt, message.createdAt)"
					:label="formatDay(message.createdAt)"
					:ui="{ label: 'text-xs text-dimmed' }"
					class="py-2"
				/>
				<ChatMessage
					:can-delete="message.authorId === user?.id || Boolean(user?.isAdmin)"
					:can-edit="message.authorId === user?.id"
					:compact="isCompact(i)"
					:editing="editingId === message.id"
					:message="message"
					@cancel-edit="editingId = null"
					@remove="removeMessage(message)"
					@save-edit="saveEdit(message, $event)"
					@start-edit="editingId = message.id"
				/>
			</template>
		</div>

		<div class="border-default shrink-0 border-t p-3">
			<MessageComposer
				:placeholder="channel ? `Написать в #${channel.name}` : 'Написать сообщение'"
				@send="send"
			/>
		</div>
	</UDashboardPanel>
</template>

<script lang="ts" setup>
import ConfirmModal from '~/components/ConfirmModal.vue'

const route = useRoute()
const store = useChannelsStore()
const realtime = useRealtime()
const { user } = useUserSession()
const toast = useToast()

const overlay = useOverlay()
const confirmModal = overlay.create(ConfirmModal)

const channelId = computed(() => route.params.id as string)
const channel = computed(() => store.channels.value.find((c) => c.id === channelId.value))

const messages = ref<MessageDto[]>([])
const hasMore = ref(false)
const loading = ref(false)
const loadingOlder = ref(false)
const editingId = ref<string | null>(null)
const scroller = ref<HTMLElement>()

const GROUP_WINDOW_MS = 5 * 60 * 1000

function isCompact(index: number) {
	const prev = messages.value[index - 1]
	const current = messages.value[index]!
	if (!prev || prev.authorId !== current.authorId) return false
	if (!sameDay(prev.createdAt, current.createdAt)) return false
	return (
		new Date(current.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
	)
}

function scrollToBottom() {
	scroller.value?.scrollTo({ top: scroller.value.scrollHeight, behavior: 'instant' })
}

function nearBottom() {
	const el = scroller.value
	if (!el) return true
	return el.scrollHeight - el.scrollTop - el.clientHeight < 150
}

async function loadInitial() {
	loading.value = true
	editingId.value = null
	try {
		const res = await $fetch(`/api/channels/${channelId.value}/messages`)
		messages.value = res.messages
		hasMore.value = res.hasMore
		await nextTick()
		scrollToBottom()
		store.markRead(channelId.value)
	} catch {
		messages.value = []
	} finally {
		loading.value = false
	}
}

async function loadOlder() {
	const first = messages.value[0]
	if (!hasMore.value || loadingOlder.value || !first) return
	loadingOlder.value = true
	try {
		const el = scroller.value
		const prevHeight = el?.scrollHeight ?? 0
		const res = await $fetch(`/api/channels/${channelId.value}/messages`, {
			query: { before: first.createdAt }
		})
		messages.value = [...res.messages, ...messages.value]
		hasMore.value = res.hasMore
		await nextTick()
		if (el) el.scrollTop += el.scrollHeight - prevHeight
	} finally {
		loadingOlder.value = false
	}
}

function onScroll() {
	if (scroller.value && scroller.value.scrollTop < 100) loadOlder()
}

async function send(content: string, attachmentIds: string[]) {
	try {
		const message = await $fetch(`/api/channels/${channelId.value}/messages`, {
			method: 'POST',
			body: { content, attachmentIds }
		})
		pushMessage(message)
	} catch (e) {
		toast.add({
			title:
				(e as { data?: { message?: string } }).data?.message ?? 'Не удалось отправить сообщение',
			color: 'error'
		})
	}
}

async function pushMessage(message: MessageDto) {
	if (messages.value.some((m) => m.id === message.id)) return
	const stick = message.authorId === user.value?.id || nearBottom()
	messages.value.push(message)
	if (stick) {
		await nextTick()
		scrollToBottom()
	}
}

async function saveEdit(message: MessageDto, content: string) {
	editingId.value = null
	const trimmed = content.trim()
	if (!trimmed || trimmed === message.content) return
	try {
		const updated = await $fetch(`/api/messages/${message.id}`, {
			method: 'PATCH',
			body: { content: trimmed }
		})
		replaceMessage(updated)
	} catch {
		toast.add({ title: 'Не удалось изменить сообщение', color: 'error' })
	}
}

function replaceMessage(message: MessageDto) {
	const index = messages.value.findIndex((m) => m.id === message.id)
	if (index !== -1) messages.value[index] = message
}

async function removeMessage(message: MessageDto) {
	const instance = confirmModal.open({
		title: 'Удалить сообщение?',
		description: 'Это действие нельзя отменить.'
	})
	if (!(await instance.result)) return
	try {
		await $fetch(`/api/messages/${message.id}`, { method: 'DELETE' })
		messages.value = messages.value.filter((m) => m.id !== message.id)
	} catch {
		toast.add({ title: 'Не удалось удалить сообщение', color: 'error' })
	}
}

realtime.onEvent((event) => {
	if (event.type === 'message.created' && event.message.channelId === channelId.value) {
		pushMessage(event.message)
	} else if (event.type === 'message.updated' && event.message.channelId === channelId.value) {
		replaceMessage(event.message)
	} else if (event.type === 'message.deleted' && event.channelId === channelId.value) {
		messages.value = messages.value.filter((m) => m.id !== event.messageId)
	} else if (event.type === 'resync') {
		loadInitial()
	}
})

watch(channelId, () => loadInitial())
onMounted(() => loadInitial())
</script>
