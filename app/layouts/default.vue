<template>
	<UDashboardGroup storage="local" storage-key="voice-chat">
		<UDashboardSidebar
			collapsible
			:min-size="14"
			:default-size="18"
			:ui="{ footer: 'border-t border-default' }"
		>
			<template #header>
				<div class="text-highlighted flex items-center gap-2 font-semibold">
					<UIcon name="i-lucide-headphones" class="text-primary size-5" />
					<span class="truncate">Голосовой чат</span>
				</div>
			</template>

			<ChannelList />

			<template #footer>
				<div class="flex w-full flex-col gap-2">
					<VoicePanel />
					<SelfPanel />
				</div>
			</template>
		</UDashboardSidebar>

		<slot />

		<MembersPanel />

		<ScreenShareOverlay />
	</UDashboardGroup>
</template>

<script lang="ts" setup>
const store = useChannelsStore()
const membersStore = useMembersStore()
const realtime = useRealtime()
const voice = useVoice()
const prefs = usePreferences()
const { user } = useUserSession()

await useAsyncData('channels', async () => {
	await Promise.all([store.refresh(), membersStore.refresh()])
	return true
})

useHead({
	title: computed(() =>
		store.unreadCount.value > 0 ? `(${store.unreadCount.value}) Голосовой чат` : 'Голосовой чат'
	)
})

realtime.onEvent((event) => {
	store.apply(event)
	membersStore.apply(event)
	if (
		event.type === 'message.created' &&
		event.message.authorId !== user.value?.id &&
		(!document.hasFocus() || store.activeChannelId.value !== event.message.channelId)
	) {
		if (prefs.value.messageSound) playMessageSound()
		notifyDesktop(event.message)
	}
})

function notifyDesktop(message: MessageDto) {
	if (
		document.hasFocus() ||
		!prefs.value.desktopNotifications ||
		!('Notification' in window) ||
		Notification.permission !== 'granted'
	) {
		return
	}
	const author = membersStore.profile(message.authorId)
	const notification = new Notification(author?.displayName ?? message.authorName, {
		body: message.content.slice(0, 120) || 'Вложение',
		// one notification per channel — repeats replace instead of stacking
		tag: message.channelId,
		icon: author?.avatarUrl ?? undefined
	})
	notification.onclick = () => {
		window.focus()
		void navigateTo(`/channels/${message.channelId}`)
		notification.close()
	}
}

// join/leave sounds for whoever enters/exits my current voice channel
let roomMemberIds: string[] = []

watch(voice.currentChannelId, (channelId) => {
	roomMemberIds = channelId ? (realtime.voice.value[channelId] ?? []).map((p) => p.memberId) : []
})

watch(realtime.voice, (rooms) => {
	const channelId = voice.currentChannelId.value
	if (!channelId) {
		roomMemberIds = []
		return
	}
	const ids = (rooms[channelId] ?? []).map((p) => p.memberId)
	const someoneJoined = ids.some((id) => !roomMemberIds.includes(id) && id !== user.value?.id)
	const someoneLeft = roomMemberIds.some((id) => !ids.includes(id) && id !== user.value?.id)
	if (someoneJoined) playJoinSound()
	else if (someoneLeft) playLeaveSound()
	roomMemberIds = ids
})

function onFocus() {
	const active = store.activeChannel.value
	if (active && store.isUnread(active)) store.markRead(active.id)
}

onMounted(() => {
	realtime.start()
	window.addEventListener('focus', onFocus)
})

onUnmounted(() => {
	window.removeEventListener('focus', onFocus)
})
</script>
