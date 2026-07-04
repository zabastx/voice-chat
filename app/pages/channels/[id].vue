<template>
	<UDashboardPanel
		id="chat"
		:ui="{ root: 'h-svh min-h-0', body: 'min-h-0 gap-0 p-0 sm:gap-0 sm:p-0' }"
	>
		<template #header>
			<UDashboardNavbar
				:title="channel ? `#${channel.name}` : ''"
				icon="i-lucide-hash"
				:toggle="false"
			>
				<template #leading>
					<SidebarToggle />
				</template>
				<template #right>
					<MembersToggle />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div
				ref="scroller"
				class="scrollbar-app min-h-0 flex-1 overflow-y-auto"
				@scroll.passive="onScroll"
			>
				<div ref="content" class="flex min-h-full flex-col px-2 py-3">
					<div v-if="loadingOlder" class="flex justify-center py-2">
						<UIcon class="text-muted size-4 animate-spin" name="i-lucide-loader-2" />
					</div>
					<p v-else-if="!hasMore && messages.length" class="text-dimmed px-4 py-2 text-xs">
						Это начало канала #{{ channel?.name }}.
					</p>
					<div
						v-if="!messages.length && !loading"
						class="flex flex-1 flex-col items-center justify-center gap-2 text-center"
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
							:flash="flashId === message.id"
							:message="message"
							@cancel-edit="editingId = null"
							@jump="jumpToMessage"
							@remove="removeMessage(message)"
							@reply="replyingTo = message"
							@save-edit="saveEdit(message, $event)"
							@start-edit="editingId = message.id"
						/>
					</template>
				</div>
			</div>

			<div class="border-default shrink-0 border-t p-3">
				<div v-if="replyingTo" class="text-muted mb-2 flex items-center gap-2 text-xs">
					<UIcon class="size-3.5 shrink-0 -scale-x-100" name="i-lucide-reply" />
					<span class="shrink-0">Ответ на</span>
					<span class="text-primary shrink-0">@{{ replyingTo.authorName }}</span>
					<span class="truncate">{{ replyPreview }}</span>
					<UButton
						class="ml-auto shrink-0"
						color="neutral"
						icon="i-lucide-x"
						size="xs"
						variant="ghost"
						@click="
							() => {
								replyingTo = null
							}
						"
					/>
				</div>
				<MessageComposer
					:placeholder="channel ? `Написать в #${channel.name}` : 'Написать сообщение'"
					@send="send"
				/>
			</div>
		</template>
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
const content = ref<HTMLElement>()
const membersStore = useMembersStore()

// message being replied to (drives the composer banner + send payload)
const replyingTo = ref<MessageDto | null>(null)
// message briefly highlighted after a reply/search jump
const flashId = ref<string | null>(null)

const replyPreview = computed(() => {
	if (!replyingTo.value) return ''
	const text = decodeMentions(replyingTo.value.content, Object.values(membersStore.members.value))
		.replace(/\s+/g, ' ')
		.trim()
	if (!text) return 'вложение'
	return text.length > 100 ? `${text.slice(0, 100)}…` : text
})

// True while the view is pinned to the newest messages. Kept in sync on scroll
// so late-loading images/videos (see MessageAttachments) and incoming messages
// re-pin to the bottom via the ResizeObserver below instead of stranding the
// user near the top.
const stick = ref(true)
let resizeObserver: ResizeObserver | undefined

const GROUP_WINDOW_MS = 5 * 60 * 1000

function isCompact(index: number) {
	const prev = messages.value[index - 1]
	const current = messages.value[index]!
	// a reply needs its header + quote visible, so never collapse it
	if (current.replyTo) return false
	if (!prev || prev.authorId !== current.authorId) return false
	if (!sameDay(prev.createdAt, current.createdAt)) return false
	return (
		new Date(current.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_WINDOW_MS
	)
}

function scrollToBottom() {
	const el = scroller.value
	if (!el) return
	el.scrollTop = el.scrollHeight
}

async function loadInitial() {
	loading.value = true
	editingId.value = null
	stick.value = true
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
	const el = scroller.value
	if (!el) return
	stick.value = el.scrollHeight - el.scrollTop - el.clientHeight < 150
	if (el.scrollTop < 100) loadOlder()
}

// Scroll to a message (reply quote / search result), loading a window around it
// if it isn't currently in view, then flash it. The `around` foundation from M1.
async function jumpToMessage(messageId: string) {
	stick.value = false
	if (!messages.value.some((m) => m.id === messageId)) {
		loading.value = true
		try {
			const res = await $fetch(`/api/channels/${channelId.value}/messages`, {
				query: { aroundId: messageId }
			})
			messages.value = res.messages
			hasMore.value = res.hasMore
		} finally {
			loading.value = false
		}
	}
	await nextTick()
	const el = scroller.value?.querySelector(`[data-message-id="${messageId}"]`)
	if (!el) return
	el.scrollIntoView({ block: 'center' })
	flashId.value = null
	await nextTick()
	flashId.value = messageId
	setTimeout(() => {
		if (flashId.value === messageId) flashId.value = null
	}, 1600)
}

async function send(content: string, attachmentIds: string[]) {
	const replyToId = replyingTo.value?.id
	try {
		const message = await $fetch(`/api/channels/${channelId.value}/messages`, {
			method: 'POST',
			body: { content, attachmentIds, replyToId }
		})
		replyingTo.value = null
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
	const pin = message.authorId === user.value?.id || stick.value
	messages.value.push(message)
	if (pin) {
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

onMounted(() => {
	loadInitial()
	if (content.value) {
		// Re-pin to the bottom whenever content grows (images loading, new
		// messages) as long as the user hasn't scrolled up.
		resizeObserver = new ResizeObserver(() => {
			if (stick.value) scrollToBottom()
		})
		resizeObserver.observe(content.value)
	}
})

onUnmounted(() => resizeObserver?.disconnect())
</script>
