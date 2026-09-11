import { describe, expect, test } from 'bun:test'

import { fixtureFileCatalog, githubReleaseCatalog } from '../server/utils/desktop-catalog'
import { selectDesktopRelease } from '../server/utils/desktop-update'

// The production adapter, driven against a stubbed fetch that answers with the
// real shape of the GitHub Releases API. The field names below were taken from
// a live `GET /repos/{owner}/{repo}/releases` response; the asset names are the
// ones tauri-action actually produces for a Windows x64 NSIS bundle.

const RELEASES_JSON = [
	{
		tag_name: 'desktop-v0.1.0-alpha.1',
		html_url: 'https://github.test/zabastx/voice-chat/releases/tag/desktop-v0.1.0-alpha.1',
		name: 'Voice Chat 0.1.0-alpha.1',
		draft: false,
		prerelease: true,
		published_at: '2026-09-09T09:00:00Z',
		body: '## Что изменилось\n\nПервая alpha.',
		assets: [
			{
				name: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe',
				browser_download_url: 'https://objects.github.test/setup.exe',
				size: 3_200_000
			},
			{
				name: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe.sig',
				browser_download_url: 'https://objects.github.test/setup.exe.sig',
				size: 444
			}
		]
	},
	{
		tag_name: 'desktop-v0.1.0-alpha.2',
		html_url: 'https://github.test/zabastx/voice-chat/releases/tag/desktop-v0.1.0-alpha.2',
		draft: true,
		prerelease: true,
		published_at: null,
		body: null,
		assets: []
	}
]

function stubFetch(handler: (url: string, init?: RequestInit) => Response) {
	const calls: { url: string; headers: Record<string, string> }[] = []
	const fetch = ((input: string | URL | Request, init?: RequestInit) => {
		const url = String(input)
		calls.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
		return Promise.resolve(handler(url, init))
	}) as unknown as typeof globalThis.fetch
	return { fetch, calls }
}

describe('githubReleaseCatalog', () => {
	test('maps the GitHub Releases payload onto the catalog interface', async () => {
		const { fetch, calls } = stubFetch(() => Response.json(RELEASES_JSON))
		const releases = await githubReleaseCatalog({ repo: 'zabastx/voice-chat', fetch }).list()

		expect(calls[0]!.url).toBe(
			'https://api.github.com/repos/zabastx/voice-chat/releases?per_page=30'
		)
		expect(calls[0]!.headers.accept).toBe('application/vnd.github+json')
		expect(calls[0]!.headers.authorization).toBeUndefined()

		expect(releases).toHaveLength(2)
		expect(releases[0]).toEqual({
			tag: 'desktop-v0.1.0-alpha.1',
			releaseUrl: 'https://github.test/zabastx/voice-chat/releases/tag/desktop-v0.1.0-alpha.1',
			draft: false,
			prerelease: true,
			publishedAt: '2026-09-09T09:00:00Z',
			notes: '## Что изменилось\n\nПервая alpha.',
			assets: [
				{
					name: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe',
					url: 'https://objects.github.test/setup.exe'
				},
				{
					name: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe.sig',
					url: 'https://objects.github.test/setup.exe.sig'
				}
			]
		})
		// a draft with no body and no assets must survive mapping, not throw
		expect(releases[1]).toMatchObject({ draft: true, publishedAt: null, notes: '', assets: [] })
	})

	test('sends the token only when one is configured', async () => {
		const { fetch, calls } = stubFetch(() => Response.json([]))
		await githubReleaseCatalog({ repo: 'zabastx/voice-chat', token: 'ghp_test', fetch }).list()
		expect(calls[0]!.headers.authorization).toBe('Bearer ghp_test')
	})

	test('treats a rate limit as an upstream failure', async () => {
		const { fetch } = stubFetch(() => new Response('rate limit exceeded', { status: 403 }))
		const catalog = githubReleaseCatalog({ repo: 'zabastx/voice-chat', fetch })
		await expect(catalog.list()).rejects.toThrow('GitHub releases request failed: 403')
	})

	test('rejects a response that is not a list of Releases', async () => {
		const { fetch } = stubFetch(() => Response.json({ message: 'Not Found' }))
		const catalog = githubReleaseCatalog({ repo: 'zabastx/voice-chat', fetch })
		await expect(catalog.list()).rejects.toThrow('GitHub releases response was not a list')
	})

	test('reads a detached signature and trims it', async () => {
		const signature = 'dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZQ=='
		const { fetch } = stubFetch(() => new Response(`${signature}\n`))
		const read = await githubReleaseCatalog({ repo: 'zabastx/voice-chat', fetch }).readSignature({
			name: 'setup.exe.sig',
			url: 'https://objects.github.test/setup.exe.sig'
		})
		expect(read).toBe(signature)
	})

	test('refuses an empty or oversized signature asset', async () => {
		const empty = stubFetch(() => new Response('   '))
		const huge = stubFetch(() => new Response('x'.repeat(5000)))
		const asset = { name: 'setup.exe.sig', url: 'https://objects.github.test/setup.exe.sig' }
		for (const { fetch } of [empty, huge]) {
			const catalog = githubReleaseCatalog({ repo: 'zabastx/voice-chat', fetch })
			await expect(catalog.readSignature(asset)).rejects.toThrow('is not a usable signature')
		}
	})

	test('reports a failed signature download rather than returning nothing', async () => {
		const { fetch } = stubFetch(() => new Response(null, { status: 500 }))
		const catalog = githubReleaseCatalog({ repo: 'zabastx/voice-chat', fetch })
		await expect(
			catalog.readSignature({ name: 'setup.exe.sig', url: 'https://objects.github.test/x.sig' })
		).rejects.toThrow('GitHub signature request failed: 500')
	})
})

describe('fixtureFileCatalog', () => {
	const path = 'test/fixtures/desktop-releases.json'

	// This fixture is what .env.example and desktop/README.md tell you to point
	// NUXT_DESKTOP_RELEASE_FIXTURE at, so it has to stay offerable — a Release
	// there missing an asset the feed requires would make those instructions lie.
	test('the documented fixture parses and yields an offerable Release', async () => {
		const catalog = fixtureFileCatalog(path)
		const selected = selectDesktopRelease(await catalog.list())
		expect(selected?.record.tag).toBe('desktop-v0.1.0-alpha.1')
		expect(await catalog.readSignature(selected!.signatureAsset)).toBeTruthy()
	})

	test('a missing fixture file fails like a failed catalog read', async () => {
		await expect(fixtureFileCatalog('test/fixtures/absent.json').list()).rejects.toThrow()
	})
})
