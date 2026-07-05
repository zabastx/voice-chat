import { eq, inArray } from 'drizzle-orm'

// The main app never talks to api.telegram.org directly (its host filters
// Telegram traffic — see adr/0006). Instead it calls the standalone
// telegram-relay service, which proxies sendMessage and forwards inbound updates
// back to /api/telegram/ingest. The feature is a no-op unless the relay is set.

export function telegramConfigured(): boolean {
	const config = useRuntimeConfig()
	return !!config.telegramRelayUrl && !!config.telegramRelaySecret
}

// Ask the relay to send a plain-text message to a chat. Returns the sent message
// id (needed for reply routing) and whether the chat blocked the bot (403 →
// caller auto-unlinks). Any relay/transport failure is logged and swallowed.
export async function tgSendMessage(
	chatId: string,
	text: string
): Promise<{ messageId: number | null; blocked: boolean }> {
	const config = useRuntimeConfig()
	if (!telegramConfigured()) return { messageId: null, blocked: false }
	try {
		const res = await fetch(`${config.telegramRelayUrl.replace(/\/$/, '')}/send`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${config.telegramRelaySecret}`
			},
			body: JSON.stringify({ chatId, text })
		})
		if (!res.ok) {
			console.error('telegram relay /send failed', res.status, await res.text())
			return { messageId: null, blocked: false }
		}
		return (await res.json()) as { messageId: number | null; blocked: boolean }
	} catch (err) {
		console.error('telegram relay /send error', err)
		return { messageId: null, blocked: false }
	}
}

// Sever a member's Telegram link. `disableNotifications` is set on auto-unlink
// (403) so a member who blocked the bot doesn't re-link with notifications still
// firing into the void; the manual unlink endpoint leaves the flag untouched.
export async function clearTelegramLink(memberId: string, disableNotifications = false) {
	await useDb()
		.update(schema.members)
		.set({
			telegramChatId: null,
			telegramLinkToken: null,
			telegramLinkTokenExpiresAt: null,
			...(disableNotifications ? { telegramNotificationsEnabled: false } : {})
		})
		.where(eq(schema.members.id, memberId))
}

// Fan a freshly-created message out to Telegram for every recipient who is
// offline (no live WS) AND has linked + enabled notifications. Recipients are the
// mentioned members for a channel message, or the other participant for a DM.
// Called fire-and-forget from createChannelMessage — must never throw into the
// send path.
export async function notifyOffline(
	channel: { id: string; kind: 'text' | 'voice' | 'dm'; name: string },
	dto: MessageDto
) {
	if (!telegramConfigured()) return
	// voice channels carry no chat; only channels and DMs notify
	let recipientIds: string[]
	if (channel.kind === 'dm') {
		recipientIds = (await channelParticipantIds(channel.id)).filter((id) => id !== dto.authorId)
	} else if (channel.kind === 'text') {
		recipientIds = mentionedIds(dto.content).filter((id) => id !== dto.authorId)
	} else {
		return
	}
	if (recipientIds.length === 0) return

	// offline = no live WS connection right now
	const online = new Set(wsOnline())
	const offlineIds = recipientIds.filter((id) => !online.has(id))
	if (offlineIds.length === 0) return

	const db = useDb()
	const rows = await db
		.select({
			id: schema.members.id,
			chatId: schema.members.telegramChatId,
			enabled: schema.members.telegramNotificationsEnabled
		})
		.from(schema.members)
		.where(inArray(schema.members.id, offlineIds))
	const targets = rows.filter((r) => r.chatId && r.enabled)
	if (targets.length === 0) return

	// decode <@id> tokens to @username for a human-readable body — only the
	// members actually mentioned need resolving, not the whole table
	const mentioned = mentionedIds(dto.content)
	const nameRows = mentioned.length
		? await db
				.select({ id: schema.members.id, username: schema.members.username })
				.from(schema.members)
				.where(inArray(schema.members.id, mentioned))
		: []
	const body = decodeMentions(dto.content, nameRows)
	const header =
		channel.kind === 'dm'
			? `Личное сообщение от ${dto.authorName}:`
			: `${dto.authorName} упомянул(а) вас в #${channel.name}:`
	const text = body ? `${header}\n${body}` : header

	for (const target of targets) {
		const { messageId, blocked } = await tgSendMessage(target.chatId!, text)
		if (blocked) {
			await clearTelegramLink(target.id, true)
			continue
		}
		if (messageId != null) {
			await db.insert(schema.telegramNotifications).values({
				id: newId(),
				memberId: target.id,
				chatId: target.chatId!,
				telegramMessageId: messageId,
				channelId: channel.id
			})
		}
	}
}
