// client-side member directory: avatars and display names for all rendering,
// kept live via the `member.updated` WS event — an upsert, so it also carries
// members who registered after this page loaded — and `member.deleted`, which
// prunes them again.
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
		} else if (event.type === 'member.deleted') {
			const { [event.memberId]: _removed, ...rest } = members.value
			members.value = rest
		} else if (event.type === 'resync') {
			void refresh()
		}
	}

	return { members, refresh, profile, apply }
}
