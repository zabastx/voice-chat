// Parsing for Watch Together sources (adr/0008). YouTube only for now; the
// return shape carries `source` so adding Twitch later doesn't change callers.
//
// The server is the authority — the client posts a raw string and never a
// parsed id — but this lives in shared/ so the modal can validate before
// sending and show the error without a round trip.

export interface ParsedWatchSource {
	source: 'youtube'
	ref: string
	// start offset from `&t=` / `?t=`, 0 when absent. Only meaningful for VODs;
	// a live broadcast ignores it.
	startSec: number
}

// YouTube ids are exactly 11 chars of base64url. Anchored so a longer garbage
// segment is rejected outright rather than silently truncated to its first 11.
const VIDEO_ID = /^[\w-]{11}$/

// Matches the bound zod enforces on every other path that sets a position
// (watch/state.post.ts). `?t=999999999999` would otherwise reach the anchor
// unvalidated, since this path never goes through that schema.
const MAX_START_SEC = 24 * 3600

// `90`, `90s`, `1m30s`, `1h2m3s` — YouTube accepts all of these on `t=`.
function parseTimeParam(raw: string | null): number {
	if (!raw) return 0
	const seconds = /^\d+$/.test(raw) ? Number(raw) : hmsToSeconds(raw)
	if (!Number.isFinite(seconds) || seconds < 0) return 0
	return Math.min(seconds, MAX_START_SEC)
}

function hmsToSeconds(raw: string): number {
	const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(raw)
	if (!match || !match[0]) return 0
	const [, h, m, s] = match
	return Number(h ?? 0) * 3600 + Number(m ?? 0) * 60 + Number(s ?? 0)
}

/**
 * Extract a YouTube video id from anything a member is likely to paste.
 * Returns null for everything else — including non-YouTube URLs, which is how
 * the endpoint rejects a Twitch link with a useful message.
 */
export function parseWatchUrl(input: string): ParsedWatchSource | null {
	const trimmed = input.trim()
	if (!trimmed) return null

	// a bare video id, pasted straight from the address bar's `v=` param
	if (VIDEO_ID.test(trimmed)) return { source: 'youtube', ref: trimmed, startSec: 0 }

	let url: URL
	try {
		// tolerate a pasted `youtu.be/…` with no scheme
		url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`)
	} catch {
		return null
	}

	const host = url.hostname.replace(/^www\./, '').toLowerCase()
	const startSec = parseTimeParam(url.searchParams.get('t') ?? url.searchParams.get('start'))
	const segments = url.pathname.split('/').filter(Boolean)

	// youtu.be/<id>
	if (host === 'youtu.be') {
		const ref = segments[0]
		return ref && VIDEO_ID.test(ref) ? { source: 'youtube', ref, startSec } : null
	}

	const hosts = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com']
	if (!hosts.includes(host)) return null

	// youtube.com/watch?v=<id>
	const v = url.searchParams.get('v')
	if (v && VIDEO_ID.test(v)) return { source: 'youtube', ref: v, startSec }

	// youtube.com/{shorts,live,embed,v}/<id> — Shorts and premieres/streams
	// resolve to ordinary embeddable video ids, so they need no special casing
	// beyond the path shape.
	const [prefix, ref] = segments
	if (prefix && ref && ['shorts', 'live', 'embed', 'v'].includes(prefix) && VIDEO_ID.test(ref)) {
		return { source: 'youtube', ref, startSec }
	}

	return null
}
