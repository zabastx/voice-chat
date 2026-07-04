import DOMPurify from 'isomorphic-dompurify'
import MarkdownIt from 'markdown-it'

// Discord-style subset: bold, italic, strikethrough, inline + fenced code,
// blockquote, lists, and (auto)links. Headings, images, and tables are
// intentionally disabled so `# foo` stays literal and remote images can't load.
// `html: false` escapes any raw HTML in the message, so DOMPurify below is
// defence-in-depth rather than the primary guard.
const md = new MarkdownIt({ html: false, linkify: true, breaks: true }).disable([
	'heading',
	'lheading',
	'image',
	'table'
])

// Force safe link attributes on every rendered anchor.
type RenderRule = NonNullable<MarkdownIt['renderer']['rules'][string]>
const defaultLinkOpen: RenderRule =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	tokens[idx]!.attrSet('target', '_blank')
	tokens[idx]!.attrSet('rel', 'noopener nofollow ugc')
	return defaultLinkOpen(tokens, idx, options, env, self)
}

const SANITIZE_CONFIG = {
	ALLOWED_TAGS: [
		'a',
		'b',
		'strong',
		'i',
		'em',
		'del',
		's',
		'code',
		'pre',
		'blockquote',
		'ul',
		'ol',
		'li',
		'p',
		'br',
		'span'
	],
	ALLOWED_ATTR: ['href', 'target', 'rel', 'class']
}

// Rendering is pure (content string → HTML), so memoize. Runs on both the Node
// dev server and the Bun prod runtime, so cap the cache to bound memory.
const cache = new Map<string, string>()
const CACHE_LIMIT = 1000

export function renderMarkdown(content: string): string {
	const hit = cache.get(content)
	if (hit !== undefined) return hit
	const html = DOMPurify.sanitize(md.render(content), SANITIZE_CONFIG)
	if (cache.size >= CACHE_LIMIT) cache.clear()
	cache.set(content, html)
	return html
}
