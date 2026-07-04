// Mentions are stored canonically as `<@memberId>` tokens so they survive
// renames — the display name is resolved live when rendering. The composer and
// edit UI work in `@username` form; the server converts on write.

type MentionMember = { id: string; username: string }

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// `@username` → `<@id>` for every known member. Longest usernames first so an
// `@ab` mention never shadows `@abc`; boundaries avoid matching inside emails.
export function encodeMentions(text: string, members: MentionMember[]): string {
	if (!text.includes('@')) return text
	const byName = new Map<string, string>()
	for (const m of members) if (m.username) byName.set(m.username, m.id)
	const names = [...byName.keys()].sort((a, b) => b.length - a.length)
	if (names.length === 0) return text
	const re = new RegExp(
		`(?<![\\p{L}\\p{N}@])@(${names.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}_-])`,
		'gu'
	)
	return text.replace(re, (_match, name: string) => `<@${byName.get(name)}>`)
}

// `<@id>` → `@username`, for populating the edit box and plain-text previews.
export function decodeMentions(content: string, members: MentionMember[]): string {
	if (!content.includes('<@')) return content
	const byId = new Map(members.map((m) => [m.id, m.username]))
	return content.replace(/<@([A-Za-z0-9_-]+)>/g, (_match, id: string) => {
		const name = byId.get(id)
		return name ? `@${name}` : '@неизвестный'
	})
}

// The member ids mentioned in a stored message (for pings / notifications).
export function mentionedIds(content: string): string[] {
	const ids = new Set<string>()
	for (const match of content.matchAll(/<@([A-Za-z0-9_-]+)>/g)) ids.add(match[1]!)
	return [...ids]
}
