import { changelog } from '~/data/changelog'

// Drives the "Что нового" badge. Version comes from package.json
// (runtimeConfig.public.appVersion); notes live in ~/data/changelog.
export function useChangelog() {
	const prefs = usePreferences()
	const currentVersion = useRuntimeConfig().public.appVersion
	const seeded = useState('changelog-seeded', () => false)

	if (import.meta.client && !seeded.value) {
		seeded.value = true
		// dev-only drift guard: newest note should match the shipped version
		if (import.meta.dev && changelog[0]?.version !== currentVersion) {
			console.warn(
				`[changelog] newest entry (${changelog[0]?.version}) != appVersion (${currentVersion}) — add a changelog entry?`
			)
		}
		// silent seed: first-ever load records the current version, no badge
		if (prefs.value.lastSeenVersion === null) prefs.value.lastSeenVersion = currentVersion
	}

	const hasUnseen = computed(
		() => prefs.value.lastSeenVersion !== null && prefs.value.lastSeenVersion !== currentVersion
	)

	function markSeen() {
		prefs.value.lastSeenVersion = currentVersion
	}

	return { changelog, currentVersion, hasUnseen, markSeen }
}
