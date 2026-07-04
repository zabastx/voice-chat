// UI-only role gates derived from the session. The server never trusts these:
// every privileged endpoint re-checks the role against the DB (docs/adr/0002).
export function useRole() {
	const { user } = useUserSession()
	const isAdmin = computed(() => user.value?.role === 'admin')
	const canModerate = computed(
		() => user.value?.role === 'admin' || user.value?.role === 'moderator'
	)
	return { isAdmin, canModerate }
}
