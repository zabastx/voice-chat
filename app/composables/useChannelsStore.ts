export function useChannelsStore() {
	const channels = useState<ChannelDto[]>('channels', () => [])
	const route = useRoute()
	// forwards the session cookie during SSR; identical to $fetch on the client
	const requestFetch = useRequestFetch()
	const { user } = useUserSession()

	const textChannels = computed(() => channels.value.filter((c) => c.kind === 'text'))
	const voiceChannels = computed(() => channels.value.filter((c) => c.kind === 'voice'))
	const activeChannelId = computed(() => route.params.id as string | undefined)
	const activeChannel = computed(() => channels.value.find((c) => c.id === activeChannelId.value))

	function isUnread(channel: ChannelDto) {
		if (channel.kind !== 'text' || !channel.lastMessageAt) return false
		return !channel.lastReadAt || channel.lastMessageAt > channel.lastReadAt
	}

	const unreadCount = computed(() => channels.value.filter(isUnread).length)

	async function refresh() {
		channels.value = await requestFetch<ChannelDto[]>('/api/channels')
	}

	async function markRead(channelId: string) {
		const channel = channels.value.find((c) => c.id === channelId)
		if (channel) channel.lastReadAt = new Date().toISOString()
		await $fetch(`/api/channels/${channelId}/read`, { method: 'POST' }).catch(() => {})
	}

	function sort() {
		channels.value.sort((a, b) => a.position - b.position)
	}

	async function apply(event: ServerEvent) {
		switch (event.type) {
			case 'channel.created': {
				if (!channels.value.some((c) => c.id === event.channel.id)) {
					channels.value.push(event.channel)
					sort()
				}
				break
			}
			case 'channel.updated': {
				const channel = channels.value.find((c) => c.id === event.channel.id)
				if (channel) {
					channel.name = event.channel.name
					channel.position = event.channel.position
					sort()
				}
				break
			}
			case 'channel.deleted': {
				channels.value = channels.value.filter((c) => c.id !== event.channelId)
				if (activeChannelId.value === event.channelId) {
					await navigateTo(textChannels.value[0] ? `/channels/${textChannels.value[0].id}` : '/')
				}
				break
			}
			case 'message.created': {
				const channel = channels.value.find((c) => c.id === event.message.channelId)
				if (!channel) break
				channel.lastMessageAt = event.message.createdAt
				// the author has obviously read their own message; createChannelMessage
				// already persisted their read cursor on the server, so mirror it here
				// and skip the /read POST. This stays correct even when the tab is
				// unfocused or the client clock is skewed relative to the server.
				if (event.message.authorId === user.value?.id) {
					channel.lastReadAt = event.message.createdAt
					break
				}
				const isActive = activeChannelId.value === channel.id
				if (isActive && document.hasFocus()) {
					await markRead(channel.id)
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
		channels,
		textChannels,
		voiceChannels,
		activeChannel,
		activeChannelId,
		unreadCount,
		isUnread,
		refresh,
		markRead,
		apply
	}
}
