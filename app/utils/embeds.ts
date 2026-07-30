// Which links in a message get an inline player card.
//
// Links are read back out of the RENDERED markdown rather than scanned from the
// raw text: markdown-it has already decided what is a link, so anything inside
// a code span or a fenced block is not an anchor and can never unfurl. Scanning
// the raw string would have to re-implement that exclusion and would get it
// subtly wrong.
//
// YouTube only, and deliberately so — this is not link unfurling (M6). The host
// is fixed and the id is validated by the same parser Watch Together uses, so
// there is no fetch, no cache table and no SSRF surface here.

export interface MessageEmbed {
	videoId: string
	startSec: number
	kind: 'video' | 'shorts'
	// the original href, replayed verbatim into `POST /watch` when someone
	// promotes the card to a shared session
	url: string
}

// More than a few players in one message is a wall, not a message.
const MAX_EMBEDS = 3

const HREF = /<a\b[^>]*\shref="([^"]*)"/g

const ENTITIES: Record<string, string> = {
	'&amp;': '&',
	'&lt;': '<',
	'&gt;': '>',
	'&quot;': '"',
	'&#39;': "'"
}

// hrefs come back HTML-escaped from the renderer — `?v=x&amp;t=30`
function unescapeHref(value: string): string {
	return value.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity)
}

/**
 * @param html   sanitized markdown output for the message
 * @param source the raw message content, only to honour `<url>` suppression
 */
export function messageEmbeds(html: string, source: string): MessageEmbed[] {
	if (!html.includes('<a ')) return []

	const embeds: MessageEmbed[] = []
	const seen = new Set<string>()

	for (const match of html.matchAll(HREF)) {
		const url = unescapeHref(match[1]!)
		// Discord convention: <https://…> posts the link without the card. The
		// angle brackets survive in the raw text — markdown renders that form as
		// an ordinary autolink, so the rendered anchor alone can't reveal it.
		if (source.includes(`<${url}>`)) continue

		const parsed = parseWatchUrl(url)
		// one card per video even when the same link is pasted twice
		if (!parsed || seen.has(parsed.ref)) continue

		seen.add(parsed.ref)
		embeds.push({ videoId: parsed.ref, startSec: parsed.startSec, kind: parsed.kind, url })
		if (embeds.length === MAX_EMBEDS) break
	}

	return embeds
}
