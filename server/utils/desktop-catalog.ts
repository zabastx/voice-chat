import { readFile } from 'node:fs/promises'

// The catalog of published Desktop Releases, behind one small interface so the
// Update feed never talks to GitHub directly (adr/0014). Production reads the
// public GitHub REST API; tests and local runs read a fixture file. Everything
// the feed needs to decide what to offer is in `DesktopReleaseRecord` — the
// adapters differ only in where those records and signatures come from.

/** One artifact attached to a Desktop Release. */
export interface DesktopReleaseAsset {
	name: string
	/** direct download URL — for a `.sig` this is what `readSignature` fetches */
	url: string
}

/** A Desktop Release as the catalog sees it, before any eligibility check. */
export interface DesktopReleaseRecord {
	/** the git tag, e.g. `desktop-v0.1.0-alpha.1` */
	tag: string
	/** public page for this exact GitHub Release */
	releaseUrl: string
	draft: boolean
	prerelease: boolean
	/** RFC 3339, null while the Release is still a draft */
	publishedAt: string | null
	/** release notes, shown by the updater dialog */
	notes: string
	assets: DesktopReleaseAsset[]
}

export interface DesktopReleaseCatalog {
	/** every Release the catalog knows about, in no guaranteed order */
	list(): Promise<DesktopReleaseRecord[]>
	/** the detached updater signature stored beside an artifact */
	readSignature(asset: DesktopReleaseAsset): Promise<string>
}

// A minisign signature is a couple of hundred base64 characters; anything much
// larger is not a signature and must not be pasted into a manifest.
const MAX_SIGNATURE_BYTES = 4096
// GitHub returns Releases newest-first, so one page covers every Release that
// could still be the newest — older pages can only hold lower versions.
const RELEASES_PER_PAGE = 30

interface GithubRelease {
	tag_name?: unknown
	html_url?: unknown
	draft?: unknown
	prerelease?: unknown
	published_at?: unknown
	body?: unknown
	assets?: unknown
}

function asString(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

/**
 * Production adapter: the public Releases list of `owner/repo`. Unauthenticated
 * calls never see drafts, but the feed filters them anyway — a token added later
 * would otherwise quietly start exposing unpublished builds.
 */
export function githubReleaseCatalog(options: {
	repo: string
	token?: string
	fetch?: typeof globalThis.fetch
}): DesktopReleaseCatalog {
	const request = options.fetch ?? globalThis.fetch
	const headers: Record<string, string> = {
		accept: 'application/vnd.github+json',
		'x-github-api-version': '2022-11-28',
		'user-agent': 'voice-chat-desktop-update-feed'
	}
	if (options.token) headers.authorization = `Bearer ${options.token}`

	return {
		async list() {
			const url = `https://api.github.com/repos/${options.repo}/releases?per_page=${RELEASES_PER_PAGE}`
			const response = await request(url, { headers })
			// 403/429 here is the rate limit; it is an upstream failure like any
			// other, and the feed answers it from its cache rather than guessing
			if (!response.ok) {
				throw new Error(`GitHub releases request failed: ${response.status}`)
			}
			const body: unknown = await response.json()
			if (!Array.isArray(body)) throw new Error('GitHub releases response was not a list')
			return body.map((entry: GithubRelease) => ({
				tag: asString(entry.tag_name),
				releaseUrl: asString(entry.html_url),
				draft: entry.draft === true,
				prerelease: entry.prerelease === true,
				publishedAt: typeof entry.published_at === 'string' ? entry.published_at : null,
				notes: asString(entry.body),
				assets: Array.isArray(entry.assets)
					? entry.assets
							.map((asset: { name?: unknown; browser_download_url?: unknown }) => ({
								name: asString(asset?.name),
								url: asString(asset?.browser_download_url)
							}))
							.filter((asset) => asset.name && asset.url)
					: []
			}))
		},

		async readSignature(asset) {
			const response = await request(asset.url, {
				headers: { 'user-agent': headers['user-agent']! }
			})
			if (!response.ok) {
				throw new Error(`GitHub signature request failed: ${response.status}`)
			}
			const text = await response.text()
			if (!text.trim() || text.length > MAX_SIGNATURE_BYTES) {
				throw new Error(`Signature asset ${asset.name} is not a usable signature`)
			}
			return text.trim()
		}
	}
}

/** The shape of a fixture file: the same records, with signatures inline. */
export interface DesktopReleaseFixture {
	releases: DesktopReleaseRecord[]
	/** signature text by asset name; a missing entry fails like a failed download */
	signatures?: Record<string, string>
}

/**
 * Deterministic adapter over a literal catalog. Same interface as the GitHub
 * one, so every selection and caching rule can be driven without a network.
 */
export function fixtureReleaseCatalog(fixture: DesktopReleaseFixture): DesktopReleaseCatalog {
	return {
		async list() {
			return fixture.releases ?? []
		},
		async readSignature(asset) {
			const signature = fixture.signatures?.[asset.name]
			if (!signature) throw new Error(`Fixture has no signature for ${asset.name}`)
			return signature
		}
	}
}

/**
 * The same fixture, read from a JSON file on every call so the catalog can be
 * edited while a dev server is running. Development only — the route refuses to
 * build one in production, because a fixture can name any URL and any signature
 * and would hand installed clients an update nobody signed.
 */
export function fixtureFileCatalog(path: string): DesktopReleaseCatalog {
	const read = async () => JSON.parse(await readFile(path, 'utf8')) as DesktopReleaseFixture
	return {
		async list() {
			return (await read()).releases ?? []
		},
		async readSignature(asset) {
			const signature = (await read()).signatures?.[asset.name]
			if (!signature) throw new Error(`Fixture has no signature for ${asset.name}`)
			return signature
		}
	}
}
