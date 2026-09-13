import type { DesktopDownloadDto } from '../../shared/types/desktop-download'
import { windowsReleaseAssets } from '../../shared/utils/desktop-release-assets'
import type {
	DesktopReleaseAsset,
	DesktopReleaseCatalog,
	DesktopReleaseRecord
} from './desktop-catalog'
import {
	compareDesktopVersions,
	type DesktopVersion,
	formatDesktopVersion,
	parseDesktopVersion
} from './desktop-version'

// The Desktop Update feed (adr/0014): one public stream that turns the catalog
// of published Desktop Releases into the Tauri updater manifest for a single
// client. It is deliberately conservative — every rule below exists so that a
// half-published Release, an unrelated tag or a GitHub outage produces "nothing
// to offer" rather than a manifest the updater would fail on, or worse, act on.
//
// The offered version and the minimum supported Desktop Release are independent:
// the minimum is configured on the server and travels in a response header, so it
// is still stated when there is no update to offer.

/** Desktop tags are `desktop-v<version>`; anything else is not a Desktop Release. */
const TAG_PREFIX = 'desktop-v'
/** Tauri's platform key for the only target this Release line builds. */
const PLATFORM_KEY = 'windows-x86_64'
/** Header carrying the minimum supported Desktop Release, offered update or not. */
export const MINIMUM_VERSION_HEADER = 'x-desktop-minimum-version'
/** How long a successful catalog read is reused before GitHub is asked again. */
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000
/** Release notes reach an updater dialog, so they are bounded before they leave. */
const MAX_NOTES_LENGTH = 4096

export interface EligibleDesktopRelease {
	record: DesktopReleaseRecord
	version: DesktopVersion
	setup: DesktopReleaseAsset
	signatureAsset: DesktopReleaseAsset
	portable: DesktopReleaseAsset
}

function isPublicHttpsPage(url: string): boolean {
	try {
		const page = new URL(url)
		return page.protocol === 'https:' && !page.username && !page.password
	} catch {
		return false
	}
}

/**
 * Picks the Release the feed should offer: the highest `desktop-v<semver>`
 * version among published Releases that carry the full x64 artifact set.
 * Prereleases count — there is one stream, not parallel channels. Ranking by
 * version rather than publish date is what makes "move the bad Release back to
 * draft" recover to the previous version, and forbids an accidental downgrade
 * when an old Release is re-published.
 */
export function selectDesktopRelease(
	releases: DesktopReleaseRecord[]
): EligibleDesktopRelease | null {
	let best: EligibleDesktopRelease | null = null
	for (const record of releases) {
		// a draft is unpublished by definition, and GitHub leaves its publish
		// timestamp empty — either alone disqualifies it
		if (record.draft || !record.publishedAt) continue
		if (!record.tag.startsWith(TAG_PREFIX)) continue
		const version = parseDesktopVersion(record.tag.slice(TAG_PREFIX.length))
		if (!version) continue
		// the Portable client opens this page in the member's browser, so a
		// Release whose page is not a plain HTTPS URL is not offerable at all
		if (!isPublicHttpsPage(record.releaseUrl)) continue
		const artifacts = windowsReleaseAssets(record.assets)
		if (!artifacts) continue
		const candidate: EligibleDesktopRelease = {
			record,
			version,
			setup: artifacts.setup,
			signatureAsset: artifacts.signature,
			portable: artifacts.portable
		}
		if (!best) {
			best = candidate
			continue
		}
		const order = compareDesktopVersions(candidate.version, best.version)
		// equal versions should not happen; prefer the later publish so a re-cut
		// tag wins over the one it replaced
		const later = (record.publishedAt ?? '') > (best.record.publishedAt ?? '')
		if (order > 0 || (order === 0 && later)) best = candidate
	}
	return best
}

/** What the feed serves, once the signature has actually been read. */
interface DesktopUpdateOffer {
	version: DesktopVersion
	releaseUrl: string
	notes: string
	pubDate: string | null
	url: string
	signature: string
	portableUrl: string
}

export interface DesktopUpdateFeedOptions {
	catalog: DesktopReleaseCatalog
	/**
	 * Minimum supported Desktop Release, independent of the offered one. An
	 * unparseable value is dropped rather than echoed: this header is a version
	 * a client compares against, and garbage in it is worse than silence.
	 */
	minimumVersion?: string
	cacheTtlMs?: number
	now?: () => number
	/** called when the catalog fails; defaults to a console warning */
	onError?: (error: unknown) => void
}

export interface DesktopUpdateFeed {
	respond(request: Request): Promise<Response>
	/**
	 * The Desktop Download for a Member without the Desktop Client: the same
	 * offer and the same cache, as plain links instead of an updater manifest.
	 */
	respondDownload(): Promise<Response>
}

function boundedNotes(notes: string) {
	const trimmed = notes.trim()
	return trimmed.length > MAX_NOTES_LENGTH ? `${trimmed.slice(0, MAX_NOTES_LENGTH)}…` : trimmed
}

function isSupportedPlatform(target: string | null, arch: string | null) {
	// Tauri fills these from its own build target; a client asking for anything
	// this Release line does not build gets "no update", not a Windows manifest
	if (target && target !== 'windows') return false
	if (arch && arch !== 'x86_64') return false
	return true
}

export function createDesktopUpdateFeed(options: DesktopUpdateFeedOptions): DesktopUpdateFeed {
	const now = options.now ?? (() => Date.now())
	const ttl = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
	const onError =
		options.onError ??
		((error: unknown) => console.warn('[desktop-update] catalog read failed', error))
	const minimum = options.minimumVersion?.trim()
		? parseDesktopVersion(options.minimumVersion)
		: null
	if (options.minimumVersion?.trim() && !minimum) {
		onError(new Error(`Ignoring unparseable minimum Desktop Release: ${options.minimumVersion}`))
	}
	const minimumHeader = minimum ? formatDesktopVersion(minimum) : null

	// The last answer GitHub actually gave, offer or no offer. It is served while
	// fresh, and kept indefinitely as the fallback for a failing catalog — a stale
	// but complete offer is always better than an improvised one.
	let cached: { offer: DesktopUpdateOffer | null; at: number } | null = null
	// After a failure, the next attempt waits a full TTL. Without this the feed
	// would hit GitHub on every single request for the whole outage, which under
	// an unauthenticated rate limit is exactly how the outage keeps itself going.
	let nextAttemptAt = 0
	let inflight: Promise<DesktopUpdateOffer | null> | null = null

	async function buildOffer(): Promise<DesktopUpdateOffer | null> {
		const selected = selectDesktopRelease(await options.catalog.list())
		if (!selected) return null
		// A signature that will not download is an upstream failure, not an
		// ineligible Release: let it throw so the cache answers instead.
		const signature = await options.catalog.readSignature(selected.signatureAsset)
		const publishedAt = selected.record.publishedAt
		return {
			version: selected.version,
			releaseUrl: selected.record.releaseUrl,
			notes: boundedNotes(selected.record.notes),
			pubDate: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : null,
			url: selected.setup.url,
			signature,
			portableUrl: selected.portable.url
		}
	}

	/**
	 * The current offer, or `undefined` when the catalog failed and nothing was
	 * ever cached — the one case where the feed cannot answer at all.
	 */
	async function currentOffer(): Promise<DesktopUpdateOffer | null | undefined> {
		if (cached && now() - cached.at < ttl) return cached.offer
		if (now() < nextAttemptAt) return cached ? cached.offer : undefined
		// one refresh at a time, so a burst of clients is a single GitHub call
		const refresh = (inflight ??= buildOffer())
		try {
			const offer = await refresh
			cached = { offer, at: now() }
			return offer
		} catch (error) {
			onError(error)
			nextAttemptAt = now() + ttl
			return cached ? cached.offer : undefined
		} finally {
			if (inflight === refresh) inflight = null
		}
	}

	return {
		async respond(request) {
			const query = new URL(request.url).searchParams
			const headers = new Headers({ 'cache-control': 'no-store' })
			if (minimumHeader) headers.set(MINIMUM_VERSION_HEADER, minimumHeader)

			if (!isSupportedPlatform(query.get('target'), query.get('arch'))) {
				return new Response(null, { status: 204, headers })
			}

			const offer = await currentOffer()
			if (offer === undefined) {
				// GitHub is unreachable and there is no last-known-good answer. Say so
				// rather than implying the client is current. The hint matches this
				// feed's own backoff; the client's own six-hourly cadence is separate.
				headers.set('retry-after', String(Math.ceil(ttl / 1000)))
				return new Response(null, { status: 503, headers })
			}
			if (!offer) return new Response(null, { status: 204, headers })

			// A version we cannot parse tells us nothing about the client, so the
			// offer stands — the updater compares versions itself and never downgrades.
			const raw = query.get('version') ?? query.get('current_version') ?? ''
			const client = parseDesktopVersion(raw)
			if (client && compareDesktopVersions(offer.version, client) <= 0) {
				return new Response(null, { status: 204, headers })
			}

			headers.set('content-type', 'application/json')
			return new Response(
				JSON.stringify({
					version: formatDesktopVersion(offer.version),
					release_url: offer.releaseUrl,
					notes: offer.notes,
					...(offer.pubDate ? { pub_date: offer.pubDate } : {}),
					platforms: {
						[PLATFORM_KEY]: { signature: offer.signature, url: offer.url }
					}
				}),
				{ status: 200, headers }
			)
		},

		async respondDownload() {
			const headers = new Headers({ 'cache-control': 'no-store' })
			const offer = await currentOffer()
			if (offer === undefined) {
				headers.set('retry-after', String(Math.ceil(ttl / 1000)))
				return new Response(null, { status: 503, headers })
			}
			if (!offer) return new Response(null, { status: 204, headers })

			const body: DesktopDownloadDto = {
				version: formatDesktopVersion(offer.version),
				setupUrl: offer.url,
				portableUrl: offer.portableUrl,
				releaseUrl: offer.releaseUrl
			}
			headers.set('content-type', 'application/json')
			return new Response(JSON.stringify(body), { status: 200, headers })
		}
	}
}
