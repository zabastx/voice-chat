import type { DesktopDownloadDto } from '~~/shared/types/desktop-download'

// The Desktop Download (CONTEXT.md) as the page sees it. Resolved in the browser
// only: whether this is Windows or a Desktop Client is unknowable during SSR, and
// guessing there would mismatch on hydration.
//
//   'desktop'     — already inside the Desktop Client; offer nothing, show its version
//   'unsupported' — a browser the Release line does not build for
//   'offer'       — a Windows browser with a Release to download
//   'fallback'    — the feed could not answer (503); send the Member to GitHub
//   'none'        — nothing to offer yet (204), or still loading
export type DesktopDownloadState = 'desktop' | 'unsupported' | 'offer' | 'fallback' | 'none'

export function useDesktopDownload() {
	const bridge = useNativeDesktop()
	const releasesPage = useRuntimeConfig().public.desktopReleasesPage
	const isWindows = ref(false)

	const { data, status } = useFetch<DesktopDownloadDto | null>('/api/desktop/download', {
		key: 'desktop-download',
		server: false,
		// a Desktop Client never shows the offer, so it never needs to ask
		immediate: import.meta.client && !bridge.isDesktop
	})

	onMounted(() => {
		// userAgentData is Chromium-only; the UA string covers Firefox and Safari
		const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
		isWindows.value = /windows/i.test(nav.userAgentData?.platform || nav.userAgent)
	})

	const state = computed<DesktopDownloadState>(() => {
		if (bridge.isDesktop) return 'desktop'
		const answered = status.value === 'error' || Boolean(data.value)
		if (!answered) return 'none'
		if (!isWindows.value) return 'unsupported'
		return data.value ? 'offer' : 'fallback'
	})

	return {
		state,
		download: data,
		releasesPage,
		desktopVersion: bridge.descriptor?.desktopVersion ?? null
	}
}
