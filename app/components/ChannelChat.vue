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
					<UButton
						aria-label="Поиск"
						color="neutral"
						icon="i-lucide-search"
						variant="ghost"
						@click="
							() => {
								searchModal.open()
							}
						"
					/>
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
							:can-delete="message.authorId === user?.id || isAdmin"
							:can-edit="message.authorId === user?.id"
							:compact="isCompact(i)"
							:editing="editingId === message.id"
							:flash="flashId === message.id"
							:message="message"
							@cancel-edit="editingId = null"
							@jump="jumpToMessage"
							@react="toggleReaction(message, $event)"
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
import SearchModal from '~/components/SearchModal.vue'

const route = useRoute()
const store = useChannelsStore()
const realtime = useRealtime()
const { user } = useUserSession()
const { isAdmin } = useRole()
const toast = useToast()

const overlay = useOverlay()
const confirmModal = overlay.create(ConfirmModal)
const searchModal = overlay.create(SearchModal)
const pendingJump = useMessageJump()

const channelId = computed(() => route.params.id as string)
const channel = computed(() => store.channels.value.find((c) => c.id === channelId.value))

const messages = ref<MessageDto[]>([])
const hasMore = ref(false)
const loading = ref(false)
const loadingOlder = ref(false)
const loadingNewer = ref(false)
// True while the loaded window ends at the live newest message. Reading history
// (scroll-up trim / jump) can detach the window from the tail; while detached we
// don't append live messages — they're pulled back in by loadNewer on scroll-down.
const atLiveEdge = ref(true)
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

// Cap on messages kept in the DOM. The list is bounded around the viewport:
// scrolling up loads older + trims the newest end, scrolling down reloads newer
// + trims the oldest. Well above a viewport's worth, so trimming only ever
// removes off-screen rows.
const RENDER_CAP = 150

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
		// a param-less fetch returns the live tail
		atLiveEdge.value = true
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
			query: { before: first.createdAt, beforeId: first.id }
		})
		messages.value = [...res.messages, ...messages.value]
		hasMore.value = res.hasMore
		await nextTick()
		// keep the viewport anchored across the prepend
		if (el) el.scrollTop += el.scrollHeight - prevHeight
		// drop the newest end past the cap — it's below the viewport, so removing
		// it is seamless (no scroll compensation) but detaches us from the tail
		if (messages.value.length > RENDER_CAP) {
			messages.value = messages.value.slice(0, RENDER_CAP)
			atLiveEdge.value = false
		}
	} finally {
		loadingOlder.value = false
	}
}

async function loadNewer() {
	const last = messages.value[messages.value.length - 1]
	if (atLiveEdge.value || loadingNewer.value || !last) return
	loadingNewer.value = true
	try {
		const el = scroller.value
		const res = await $fetch(`/api/channels/${channelId.value}/messages`, {
			query: { after: last.createdAt, afterId: last.id }
		})
		// appended below the viewport → seamless, no compensation needed
		messages.value = [...messages.value, ...res.messages]
		if (!res.hasMoreNewer) atLiveEdge.value = true
		// trim the oldest end past the cap; it's above the viewport, so compensate
		// scrollTop for the removed height to keep the view anchored
		if (el && messages.value.length > RENDER_CAP) {
			const prevHeight = el.scrollHeight
			messages.value = messages.value.slice(messages.value.length - RENDER_CAP)
			hasMore.value = true
			await nextTick()
			el.scrollTop -= prevHeight - el.scrollHeight
		}
	} finally {
		loadingNewer.value = false
	}
}

// Drop history above the cap while pinned to the tail. Safe only when the view
// is at the bottom: the removed rows are off-screen above and the caller
// re-pins with scrollToBottom.
function trimToLiveWindow() {
	if (messages.value.length > RENDER_CAP) {
		messages.value = messages.value.slice(-RENDER_CAP)
		hasMore.value = true
	}
}

function onScroll() {
	const el = scroller.value
	if (!el) return
	const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
	// only "stuck" when the tail is actually loaded — near the bottom of a
	// detached window there are still newer messages to pull in
	stick.value = atLiveEdge.value && distanceToBottom < 150
	if (el.scrollTop < 100) loadOlder()
	if (!atLiveEdge.value && distanceToBottom < 200) loadNewer()
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
			// the window is centred on an older message, so the tail may be trimmed
			atLiveEdge.value = !res.hasMoreNewer
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
		// if we're reading detached history, snap back to the tail so the sent
		// message is visible instead of being dropped by the live-edge guard
		if (!atLiveEdge.value) {
			await loadInitial()
		} else {
			pushMessage(message)
		}
	} catch (e) {
		toast.add({
			title:
				(e as { data?: { message?: string } }).data?.message ?? 'Не удалось отправить сообщение',
			color: 'error'
		})
	}
}

async function pushMessage(message: MessageDto) {
	// while detached from the tail, a live message belongs beyond the loaded
	// window — ignore it here; loadNewer will fetch it on scroll-down
	if (!atLiveEdge.value) return
	if (messages.value.some((m) => m.id === message.id)) return
	const pin = message.authorId === user.value?.id || stick.value
	messages.value.push(message)
	if (pin) {
		await nextTick()
		trimToLiveWindow()
		await nextTick()
		scrollToBottom()
	}
}

async function toggleReaction(message: MessageDto, emoji: string) {
	try {
		const updated = await $fetch(`/api/messages/${message.id}/reactions`, {
			method: 'POST',
			body: { emoji }
		})
		replaceMessage(updated)
	} catch {
		toast.add({ title: 'Не удалось поставить реакцию', color: 'error' })
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

// consume a pending "jump to message" handed over from search once the target
// channel is active (its history may need an around-window load)
function applyPendingJump() {
	const jump = pendingJump.value
	if (jump && jump.channelId === channelId.value) {
		pendingJump.value = null
		jumpToMessage(jump.messageId)
	}
}

watch(channelId, () => loadInitial().then(applyPendingJump))
// same-channel search result: channelId didn't change, so react to the jump itself
watch(pendingJump, (jump) => {
	if (jump && jump.channelId === channelId.value) applyPendingJump()
})

onMounted(() => {
	loadInitial().then(applyPendingJump)
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
