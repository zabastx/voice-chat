import { toWebRequest } from 'h3'

import type { DesktopUpdateFeed } from '../../utils/desktop-update'

// The public Desktop Update feed (adr/0014). It is reachable before Sign-in on
// purpose: the Desktop Client checks it at startup, before the remote Web
// Release — and therefore any session — has loaded. Tauri fills the query from
// its own build: ?target=windows&arch=x86_64&version=<current>.
//
// Everything interesting lives in the feed itself; this is only the wiring from
// runtime config to it.

let feed: DesktopUpdateFeed | undefined

export default defineEventHandler(async (event) => {
	if (!feed) {
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
	}
	return feed.respond(toWebRequest(event))
})
