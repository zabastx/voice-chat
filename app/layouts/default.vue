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
				<div class="flex w-full items-center gap-2">
					<UIcon name="i-lucide-headphones" class="text-primary size-5 shrink-0" />
					<span class="text-highlighted truncate font-semibold">Voice Chat</span>
					<span class="text-dimmed shrink-0 text-xs">v{{ currentVersion }}</span>
					<!-- ClientOnly: hasUnseen comes from localStorage, so SSR can't know it -->
					<ClientOnly>
						<UTooltip text="Что нового">
							<UChip :show="hasUnseen" class="ms-auto" color="primary" inset size="md">
								<UButton
									color="neutral"
									icon="i-lucide-sparkles"
									size="xs"
									variant="ghost"
									@click="openChangelog"
								/>
							</UChip>
						</UTooltip>
					</ClientOnly>
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
import ChangelogModal from '~/components/ChangelogModal.vue'

const store = useChannelsStore()
const membersStore = useMembersStore()
const dmStore = useDmStore()
const { channelsOpen, channelsHidden } = usePanels()
const realtime = useRealtime()
const voice = useVoice()
const prefs = usePreferences()
const { user, fetch: fetchSession } = useUserSession()
const { currentVersion, hasUnseen, markSeen } = useChangelog()

const overlay = useOverlay()
const changelogModal = overlay.create(ChangelogModal)

function openChangelog() {
	markSeen()
	changelogModal.open()
}

await useAsyncData('channels', async () => {
	await Promise.all([store.refresh(), membersStore.refresh(), dmStore.refresh()])
	return true
})

const totalUnread = computed(() => store.unreadCount.value + dmStore.unreadCount.value)

useHead({
	title: computed(() =>
		totalUnread.value > 0 ? `(${totalUnread.value}) Voice Chat` : 'Voice Chat'
	)
})

// guards authorize against the DB, so the cookie role is UI-only — re-seal it
// when it drifts (own promotion/demotion, or a pre-role cookie after deploy)
async function refreshSession() {
	try {
		await $fetch('/api/auth/refresh', { method: 'POST' })
		await fetchSession()
	} catch {
		// ignored: an expired session already redirects via auth middleware
	}
}

realtime.onEvent((event) => {
	store.apply(event)
	membersStore.apply(event)
	dmStore.apply(event)
	if (
		event.type === 'member.updated' &&
		event.member.id === user.value?.id &&
		event.member.role !== user.value?.role
	) {
		void refreshSession()
	}
	if (event.type === 'message.created' && event.message.authorId !== user.value?.id) {
		const isDm = dmStore.isDm(event.message.channelId)
		const mentionsMe =
			Boolean(user.value) && mentionedIds(event.message.content).includes(user.value!.id)
		const away = !document.hasFocus() || store.activeChannelId.value !== event.message.channelId
		// a DM or a mention pings even when another channel is focused; a DM stays
		// quiet only while you're actually looking at that conversation
		if (prefs.value.messageSound) {
			if (isDm) {
				if (away) playMentionSound()
			} else if (mentionsMe) playMentionSound()
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
	const dmConvo = dmStore.conversation(dmStore.activeChannelId.value)
	if (dmConvo && dmStore.isUnread(dmConvo)) dmStore.markRead(dmConvo.channelId)
}

onMounted(() => {
	realtime.start()
	window.addEventListener('focus', onFocus)
	// sessions sealed before the role column existed carry no role
	if (user.value && !user.value.role) void refreshSession()
})

onUnmounted(() => {
	window.removeEventListener('focus', onFocus)
})
</script>
