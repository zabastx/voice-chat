import { fixtureFileCatalog, githubReleaseCatalog } from './desktop-catalog'
import { createDesktopUpdateFeed, type DesktopUpdateFeed } from './desktop-update'

// The one Desktop Update feed this server runs (adr/0014), shared by the updater
// route and the Desktop Download route so both answer from the same cache — and
// therefore always name the same Release. This is only the wiring from runtime
// config to the feed.

let feed: DesktopUpdateFeed | undefined

export function useDesktopUpdateFeed(): DesktopUpdateFeed {
	if (feed) return feed
	const config = useRuntimeConfig()
	const cacheSeconds = Number(config.desktopUpdateCacheSeconds)
	// The fixture catalog is a development affordance for driving the feed
	// without publishing a Release. It can name any URL and any signature, so
	// a production build ignores it however the environment is set.
	const fixture = import.meta.dev ? config.desktopReleaseFixture : ''
	if (!import.meta.dev && config.desktopReleaseFixture) {
		console.warn('[desktop-update] ignoring NUXT_DESKTOP_RELEASE_FIXTURE outside development')
	}
	feed = createDesktopUpdateFeed({
		catalog: fixture
			? fixtureFileCatalog(fixture)
			: githubReleaseCatalog({
					repo: config.desktopReleaseRepo,
					token: config.desktopGithubToken || undefined
				}),
		minimumVersion: config.desktopMinimumVersion || undefined,
		cacheTtlMs: cacheSeconds > 0 ? cacheSeconds * 1000 : undefined
	})
	return feed
}
