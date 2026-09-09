import { describe, expect, test } from 'bun:test'

import {
	type DesktopReleaseCatalog,
	type DesktopReleaseRecord,
	fixtureReleaseCatalog
} from '../server/utils/desktop-catalog'
import {
	createDesktopUpdateFeed,
	type DesktopUpdateFeedOptions,
	MINIMUM_VERSION_HEADER
} from '../server/utils/desktop-update'

// The Desktop Update feed is driven over real HTTP against a fixture catalog of
// GitHub Releases (spec #4, #8): the same interface the production GitHub
// adapter implements, so every selection, version and failure rule below is the
// one a Desktop Client would meet.

const ASSET_HOST = 'https://github.test/zabastx/voice-chat/releases/download'

function setupName(version: string) {
	return `Voice Chat_${version}_x64-setup.exe`
}

function signatureOf(version: string) {
	return `untrusted comment: signature for ${version}\nRWQ${version.replace(/\W/g, '')}=`
}

/** A complete, offerable Windows x64 Release. */
function release(version: string, extra: Partial<DesktopReleaseRecord> = {}): DesktopReleaseRecord {
	const setup = setupName(version)
	const base = `${ASSET_HOST}/desktop-v${version}`
	return {
		tag: `desktop-v${version}`,
		draft: false,
		prerelease: version.includes('-'),
		publishedAt: '2026-09-01T10:00:00Z',
		notes: `## Что изменилось\n\nВерсия ${version}`,
		assets: [
			{ name: setup, url: `${base}/${encodeURIComponent(setup)}` },
			{ name: `${setup}.sig`, url: `${base}/${encodeURIComponent(setup)}.sig` },
			{
				name: `Voice Chat_${version}_x64-portable.exe`,
				url: `${base}/Voice%20Chat_${version}_x64-portable.exe`
			},
			{ name: 'latest.json', url: `${base}/latest.json` }
		],
		...extra
	}
}

function signaturesFor(versions: string[]) {
	return Object.fromEntries(
		versions.map((version) => [`${setupName(version)}.sig`, signatureOf(version)])
	)
}

function catalogOf(releases: DesktopReleaseRecord[]): DesktopReleaseCatalog {
	const versions = releases.map((record) => record.tag.replace(/^desktop-v/, ''))
	return fixtureReleaseCatalog({ releases, signatures: signaturesFor(versions) })
}

/** Runs one HTTP conversation against a feed and shuts the server down after. */
async function withFeed(
	options: Omit<DesktopUpdateFeedOptions, 'onError'>,
	run: (get: (query?: string) => Promise<Response>) => Promise<void>
) {
	// tests drive failure paths deliberately; keep the warning out of the output
	const feed = createDesktopUpdateFeed({ ...options, onError: () => {} })
	const server = Bun.serve({ port: 0, fetch: (request) => feed.respond(request) })
	const get = (query = '?target=windows&arch=x86_64') =>
		fetch(`http://127.0.0.1:${server.port}/api/desktop/update${query}`)
	try {
		await run(get)
	} finally {
		await server.stop(true)
	}
}

/** Same, for the common case of a static catalog. */
async function withCatalog(
	releases: DesktopReleaseRecord[],
	run: (get: (query?: string) => Promise<Response>) => Promise<void>,
	options: Omit<Partial<DesktopUpdateFeedOptions>, 'catalog' | 'onError'> = {}
) {
	await withFeed({ catalog: catalogOf(releases), ...options }, run)
}

describe('GET /api/desktop/update — which Release is offered', () => {
	test('offers the newest published Release as a Tauri manifest', async () => {
		await withCatalog([release('0.1.0-alpha.1'), release('0.2.0')], async (get) => {
			const response = await get('?target=windows&arch=x86_64&version=0.1.0-alpha.1')
			expect(response.status).toBe(200)
			expect(response.headers.get('content-type')).toContain('application/json')

			const manifest = await response.json()
			expect(manifest.version).toBe('0.2.0')
			expect(manifest.notes).toContain('Версия 0.2.0')
			expect(manifest.pub_date).toBe('2026-09-01T10:00:00Z')
			expect(Object.keys(manifest.platforms)).toEqual(['windows-x86_64'])
			expect(manifest.platforms['windows-x86_64'].signature).toBe(signatureOf('0.2.0'))
			expect(manifest.platforms['windows-x86_64'].url).toContain('x64-setup.exe')
		})
	})

	test('offers a prerelease when it is the newest — there is one update stream', async () => {
		await withCatalog([release('0.1.0'), release('0.2.0-alpha.3')], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0-alpha.3')
		})
	})

	test('ignores a draft Release', async () => {
		const draft = release('0.3.0', { draft: true, publishedAt: null })
		await withCatalog([release('0.2.0'), draft], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('ignores a Release that carries a draft flag but kept a publish date', async () => {
		// moving a bad Release back to draft must stop new offers immediately
		const redrafted = release('0.3.0', { draft: true })
		await withCatalog([release('0.2.0'), redrafted], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('ignores tags that are not Desktop Releases', async () => {
		const web = release('0.25.0', { tag: 'v0.25.0' })
		const relay = release('0.4.0', { tag: 'relay-v0.4.0' })
		await withCatalog([web, relay, release('0.2.0')], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('ignores a Release whose version is malformed', async () => {
		const malformed = release('0.3.0', { tag: 'desktop-vbanana' })
		const partial = release('0.4.0', { tag: 'desktop-v0.4' })
		await withCatalog([malformed, partial, release('0.2.0')], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('ignores a Release built for the wrong architecture', async () => {
		const arm = release('0.3.0')
		arm.assets = arm.assets.map((asset) => ({
			...asset,
			name: asset.name.replace('x64', 'arm64')
		}))
		await withCatalog([arm, release('0.2.0')], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('ignores a Release whose updater signature asset is missing', async () => {
		const unsigned = release('0.3.0')
		unsigned.assets = unsigned.assets.filter((asset) => !asset.name.endsWith('.sig'))
		await withCatalog([unsigned, release('0.2.0')], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('ignores a Release whose setup is missing', async () => {
		const orphaned = release('0.3.0')
		orphaned.assets = orphaned.assets.filter((asset) => !asset.name.endsWith('-setup.exe'))
		await withCatalog([orphaned, release('0.2.0')], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('ignores a Release whose Portable EXE is missing', async () => {
		// adr/0014 makes the Portable EXE a release asset, not a CI leftover: the
		// job builds all three together, so a Release without it was not built whole
		const partial = release('0.3.0')
		partial.assets = partial.assets.filter((asset) => !asset.name.includes('portable'))
		await withCatalog([partial, release('0.2.0')], async (get) => {
			const manifest = await (await get('?target=windows&arch=x86_64&version=0.1.0')).json()
			expect(manifest.version).toBe('0.2.0')
		})
	})

	test('offers nothing when no Release is eligible', async () => {
		await withCatalog([release('0.3.0', { draft: true, publishedAt: null })], async (get) => {
			const response = await get('?target=windows&arch=x86_64&version=0.1.0')
			expect(response.status).toBe(204)
			expect(await response.text()).toBe('')
		})
	})
})

describe('GET /api/desktop/update — what the client asks for', () => {
	const catalog = [release('0.2.0')]

	test('offers the update to an older client', async () => {
		await withCatalog(catalog, async (get) => {
			const response = await get('?target=windows&arch=x86_64&version=0.1.0-alpha.9')
			expect(response.status).toBe(200)
			expect((await response.json()).version).toBe('0.2.0')
		})
	})

	test('offers nothing to a current client', async () => {
		await withCatalog(catalog, async (get) => {
			expect((await get('?target=windows&arch=x86_64&version=0.2.0')).status).toBe(204)
		})
	})

	test('offers nothing to a newer client — the feed never downgrades', async () => {
		await withCatalog(catalog, async (get) => {
			expect((await get('?target=windows&arch=x86_64&version=0.3.0')).status).toBe(204)
		})
	})

	test('offers nothing for a target this Release line does not build', async () => {
		await withCatalog(catalog, async (get) => {
			expect((await get('?target=darwin&arch=x86_64&version=0.1.0')).status).toBe(204)
			expect((await get('?target=windows&arch=aarch64&version=0.1.0')).status).toBe(204)
		})
	})

	test('still offers when the client sends no or an unreadable version', async () => {
		await withCatalog(catalog, async (get) => {
			expect((await get('?target=windows&arch=x86_64')).status).toBe(200)
			expect((await get('?target=windows&arch=x86_64&version=nightly')).status).toBe(200)
		})
	})

	test('answers a bare check with no query at all', async () => {
		// the feed must not depend on Tauri filling every template variable
		await withCatalog(catalog, async (get) => {
			expect((await get('')).status).toBe(200)
		})
	})
})

describe('GET /api/desktop/update — minimum supported Release', () => {
	test('states the minimum independently of the offered version', async () => {
		await withCatalog(
			[release('0.2.0')],
			async (get) => {
				const offered = await get('?target=windows&arch=x86_64&version=0.1.0')
				expect(offered.status).toBe(200)
				expect((await offered.json()).version).toBe('0.2.0')
				expect(offered.headers.get(MINIMUM_VERSION_HEADER)).toBe('0.1.5')

				// still stated when there is nothing to offer
				const current = await get('?target=windows&arch=x86_64&version=0.2.0')
				expect(current.status).toBe(204)
				expect(current.headers.get(MINIMUM_VERSION_HEADER)).toBe('0.1.5')
			},
			{ minimumVersion: '0.1.5' }
		)
	})

	test('drops an unparseable minimum rather than echoing it', async () => {
		await withCatalog(
			[release('0.2.0')],
			async (get) => {
				const response = await get('?target=windows&arch=x86_64&version=0.1.0')
				expect(response.status).toBe(200)
				expect(response.headers.get(MINIMUM_VERSION_HEADER)).toBeNull()
			},
			{ minimumVersion: 'не версия' }
		)
	})

	test('omits the header when no minimum is configured', async () => {
		await withCatalog([release('0.2.0')], async (get) => {
			const response = await get('?target=windows&arch=x86_64&version=0.1.0')
			expect(response.headers.get(MINIMUM_VERSION_HEADER)).toBeNull()
		})
	})
})

describe('GET /api/desktop/update — upstream failure and caching', () => {
	/** A catalog that can be broken and repaired, and counts its reads. */
	function flakyCatalog(releases: DesktopReleaseRecord[], delayMs = 0) {
		const inner = catalogOf(releases)
		const state = { reads: 0, failing: false }
		const catalog: DesktopReleaseCatalog = {
			async list() {
				state.reads += 1
				if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
				if (state.failing) throw new Error('GitHub releases request failed: 403')
				return inner.list()
			},
			async readSignature(asset) {
				if (state.failing) throw new Error('GitHub signature request failed: 500')
				return inner.readSignature(asset)
			}
		}
		return { catalog, state }
	}

	test('answers 503 when GitHub fails and nothing was ever cached', async () => {
		const { catalog, state } = flakyCatalog([release('0.2.0')])
		state.failing = true
		await withFeed({ catalog, cacheTtlMs: 60_000 }, async (get) => {
			const response = await get('?target=windows&arch=x86_64&version=0.1.0')
			expect(response.status).toBe(503)
			expect(await response.text()).toBe('')
			// the hint matches the feed's own backoff window, not the client's cadence
			expect(response.headers.get('retry-after')).toBe('60')
		})
	})

	test('answers 503 when the signature cannot be downloaded — never a manifest without one', async () => {
		const inner = catalogOf([release('0.2.0')])
		const catalog: DesktopReleaseCatalog = {
			list: () => inner.list(),
			readSignature: () => Promise.reject(new Error('GitHub signature request failed: 500'))
		}
		await withFeed({ catalog }, async (get) => {
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(503)
		})
	})

	test('keeps serving the last good offer while GitHub is failing', async () => {
		const { catalog, state } = flakyCatalog([release('0.2.0')])
		let clock = 1_000
		await withFeed({ catalog, cacheTtlMs: 60_000, now: () => clock }, async (get) => {
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(200)

			state.failing = true
			clock += 120_000 // past the TTL, so the feed does try GitHub again
			const stale = await get('?target=windows&arch=x86_64&version=0.1.0')
			expect(stale.status).toBe(200)
			expect((await stale.json()).version).toBe('0.2.0')
			expect(state.reads).toBe(2)
		})
	})

	test('serves a cache hit without asking GitHub again', async () => {
		const { catalog, state } = flakyCatalog([release('0.2.0')])
		let clock = 1_000
		await withFeed({ catalog, cacheTtlMs: 60_000, now: () => clock }, async (get) => {
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(200)
			clock += 30_000
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(200)
			expect(state.reads).toBe(1)

			clock += 60_000
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(200)
			expect(state.reads).toBe(2)
		})
	})

	test('caches "nothing to offer" too, and recovers once GitHub does', async () => {
		const releases: DesktopReleaseRecord[] = []
		const inner = { current: catalogOf(releases) }
		let reads = 0
		let clock = 1_000
		const catalog: DesktopReleaseCatalog = {
			async list() {
				reads += 1
				return inner.current.list()
			},
			readSignature: (asset) => inner.current.readSignature(asset)
		}
		await withFeed({ catalog, cacheTtlMs: 60_000, now: () => clock }, async (get) => {
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(204)
			clock += 30_000
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(204)
			expect(reads).toBe(1)

			inner.current = catalogOf([release('0.2.0')])
			clock += 60_000
			const response = await get('?target=windows&arch=x86_64&version=0.1.0')
			expect(response.status).toBe(200)
			expect((await response.json()).version).toBe('0.2.0')
		})
	})

	test('backs off after a failure instead of retrying on every request', async () => {
		const { catalog, state } = flakyCatalog([release('0.2.0')])
		state.failing = true
		let clock = 1_000
		await withFeed({ catalog, cacheTtlMs: 60_000, now: () => clock }, async (get) => {
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(503)
			// without a backoff every request during the outage would hit GitHub again,
			// which under an unauthenticated rate limit prolongs the outage
			for (let attempt = 0; attempt < 4; attempt++) {
				clock += 10_000
				expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(503)
			}
			expect(state.reads).toBe(1)

			clock += 30_000 // past the backoff window
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(503)
			expect(state.reads).toBe(2)

			state.failing = false
			clock += 60_000
			expect((await get('?target=windows&arch=x86_64&version=0.1.0')).status).toBe(200)
		})
	})

	test('collapses a burst of clients into one catalog read', async () => {
		// the read is held open long enough for all five to be in the handler at once
		const { catalog, state } = flakyCatalog([release('0.2.0')], 50)
		await withFeed({ catalog }, async (get) => {
			const responses = await Promise.all(
				Array.from({ length: 5 }, () => get('?target=windows&arch=x86_64&version=0.1.0'))
			)
			for (const response of responses) expect(response.status).toBe(200)
			expect(state.reads).toBe(1)
		})
	})
})
