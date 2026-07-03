// client-side member directory: avatars and display names for all rendering,
// kept live via the `member.updated` WS event
export function useMembersStore() {
	const members = useState<Record<string, MemberDto>>('members', () => ({}))
	const requestFetch = useRequestFetch()

	async function refresh() {
		const list = await requestFetch('/api/members')
		members.value = Object.fromEntries(list.map((m) => [m.id, m]))
	}

	function profile(id: string | undefined): MemberDto | undefined {
		return id ? members.value[id] : undefined
	}

	function apply(event: ServerEvent) {
		if (event.type === 'member.updated') {
			members.value = { ...members.value, [event.member.id]: event.member }
		} else if (event.type === 'resync') {
			void refresh()
		}
	}

	return { members, refresh, profile, apply }
}
