export function useDmStore() {
	const conversations = useState<DmConversationDto[]>('dm-conversations', () => [])
	const route = useRoute()
	const requestFetch = useRequestFetch()
	const { user } = useUserSession()

	// most recent activity first; empty conversations sink to the bottom
	const sorted = computed(() =>
		[...conversations.value].sort((a, b) =>
			(b.lastMessageAt ?? '').localeCompare(a.lastMessageAt ?? '')
		)
	)

	const activeChannelId = computed(() => route.params.id as string | undefined)

	function conversation(channelId: string | undefined) {
		if (!channelId) return undefined
		return conversations.value.find((c) => c.channelId === channelId)
	}

	function isDm(channelId: string | undefined) {
		return Boolean(conversation(channelId))
	}

	function isUnread(convo: DmConversationDto) {
		if (!convo.lastMessageAt) return false
		return !convo.lastReadAt || convo.lastMessageAt > convo.lastReadAt
	}

	const unreadCount = computed(() => conversations.value.filter(isUnread).length)

	async function refresh() {
		conversations.value = await requestFetch<DmConversationDto[]>('/api/dm')
	}

	async function markRead(channelId: string) {
		const convo = conversation(channelId)
		if (convo) convo.lastReadAt = new Date().toISOString()
		// DM channels reuse the shared read endpoint (memberChannelState)
		await $fetch(`/api/channels/${channelId}/read`, { method: 'POST' }).catch(() => {})
	}

	function upsert(convo: DmConversationDto) {
		const existing = conversation(convo.channelId)
		if (existing) Object.assign(existing, convo)
		else conversations.value.push(convo)
	}

	// Open (or create) the DM with `memberId` and navigate to it. Shared by every
	// entry point — members panel, chat author menu, voice menu, the "+" picker.
	async function openDm(memberId: string) {
		const convo = await $fetch<DmConversationDto>('/api/dm', {
			method: 'POST',
			body: { memberId }
		})
		upsert(convo)
		await navigateTo(`/channels/${convo.channelId}`)
	}

	async function apply(event: ServerEvent) {
		switch (event.type) {
			case 'dm.created': {
				upsert(event.conversation)
				break
			}
			case 'message.created': {
				const convo = conversation(event.message.channelId)
				if (!convo) break
				convo.lastMessageAt = event.message.createdAt
				// the author has obviously read their own message; createChannelMessage
				// already persisted their read cursor on the server, so mirror it here
				// and skip the /read POST. This stays correct even when the tab is
				// unfocused or the client clock is skewed relative to the server.
				if (event.message.authorId === user.value?.id) {
					convo.lastReadAt = event.message.createdAt
					break
				}
				if (activeChannelId.value === convo.channelId && document.hasFocus()) {
					await markRead(convo.channelId)
				}
				break
			}
			case 'resync': {
				await refresh()
				break
			}
		}
	}

	return {
		conversations,
		sorted,
		activeChannelId,
		conversation,
		isDm,
		isUnread,
		unreadCount,
		refresh,
		markRead,
		openDm,
		apply
	}
}
