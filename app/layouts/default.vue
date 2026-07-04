<template>
	<UDashboardGroup storage="local" storage-key="voice-chat">
		<UDashboardSidebar
			v-model:open="channelsOpen"
			:min-size="14"
			:default-size="18"
			:ui="{
				footer: 'border-t border-default',
				root: channelsHidden ? 'lg:hidden' : ''
			}"
		>
			<!-- built-in toggle fires a group-wide hook that opens BOTH sidebars; replace it.
			     toggleSide defaults to 'left' so the close X sits where the hamburger opened it. -->
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
				<div class="text-highlighted flex items-center gap-2 font-semibold">
					<UIcon name="i-lucide-headphones" class="text-primary size-5" />
					<span class="truncate">Voice Chat</span>
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
	</UDashboardGroup>
</template>

<script lang="ts" setup>
const store = useChannelsStore()
const membersStore = useMembersStore()
const { channelsOpen, channelsHidden } = usePanels()
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
		store.unreadCount.value > 0 ? `(${store.unreadCount.value}) Voice Chat` : 'Voice Chat'
	)
})

realtime.onEvent((event) => {
	store.apply(event)
	membersStore.apply(event)
	if (event.type === 'message.created' && event.message.authorId !== user.value?.id) {
		const mentionsMe =
			Boolean(user.value) && mentionedIds(event.message.content).includes(user.value!.id)
		const away = !document.hasFocus() || store.activeChannelId.value !== event.message.channelId
		// a mention pings even when the channel is focused; it wins over the
		// plain message sound so we never play both
		if (prefs.value.messageSound) {
			if (mentionsMe) playMentionSound()
			else if (away) playMessageSound()
		}
		if (away) notifyDesktop(event.message)
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
	const body = decodeMentions(message.content, Object.values(membersStore.members.value))
	const notification = new Notification(author?.displayName ?? message.authorName, {
		body: body.slice(0, 120) || 'Вложение',
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
