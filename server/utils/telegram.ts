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
	const [member] = await useDb()
		.update(schema.members)
		.set({
			telegramChatId: null,
			telegramLinkToken: null,
			telegramLinkTokenExpiresAt: null,
			...(disableNotifications ? { telegramNotificationsEnabled: false } : {})
		})
		.where(eq(schema.members.id, memberId))
		.returning()
	if (member) wsBroadcast({ type: 'member.updated', member: memberDto(member) })
}

// Telegram caps a media caption at 1024 chars (vs 4096 for sendMessage); text
// longer than that must go as its own message ahead of the media.
const TG_CAPTION_MAX = 1024

type TgMediaItem = {
	type: 'voice' | 'photo' | 'video' | 'document'
	filename: string
	objectKey: string
	mime: string
}

// Map an attachment to the Telegram send method that best represents it. Voice
// messages (the app's recorded `voice-message-*` clips) go as `sendVoice` so
// Telegram plays them inline with a waveform; images as `sendPhoto`, video as
// `sendVideo`, anything else as `sendDocument`.
function tgMediaType(att: { filename: string; mime: string }): TgMediaItem['type'] {
	if (att.filename.startsWith('voice-message-')) return 'voice'
	if (att.mime.startsWith('image/')) return 'photo'
	if (att.mime.startsWith('video/')) return 'video'
	return 'document'
}

// Record a mapping row for a delivered Telegram message so a reply to it routes
// back into the right channel/DM as the right member.
async function recordNotification(opts: {
	memberId: string
	chatId: string
	telegramMessageId: number
	channelId: string
}) {
	await useDb().insert(schema.telegramNotifications).values({
		id: newId(),
		memberId: opts.memberId,
		chatId: opts.chatId,
		telegramMessageId: opts.telegramMessageId,
		channelId: opts.channelId
	})
}

// Ask the relay to forward an attachment to a chat via the matching Telegram
// send* method. The app fetches the object from S3 (header-signed GET — the
// bucket is private and Telegram's servers can't reach it) and uploads the bytes
// multipart to the relay, which proxies them to Telegram. `caption` is attached
// only when it fits Telegram's 1024-char media-caption limit. As with
// tgSendMessage, transport failures are logged and swallowed; a 403 returns
// `blocked: true` so the caller auto-unlinks.
export async function tgSendMedia(
	chatId: string,
	opts: {
		type: TgMediaItem['type']
		caption?: string
		filename: string
		objectKey: string
		mime: string
	}
): Promise<{ messageId: number | null; blocked: boolean }> {
	const config = useRuntimeConfig()
	if (!telegramConfigured()) return { messageId: null, blocked: false }
	try {
		const objRes = await getObject(opts.objectKey)
		if (!objRes.ok) {
			console.error('telegram media S3 fetch failed', opts.objectKey, objRes.status)
			return { messageId: null, blocked: false }
		}
		const bytes = await objRes.arrayBuffer()
		const form = new FormData()
		form.append('chatId', chatId)
		form.append('type', opts.type)
		if (opts.caption != null) form.append('caption', opts.caption)
		form.append('file', new Blob([bytes], { type: opts.mime }), opts.filename)
		const res = await fetch(`${config.telegramRelayUrl.replace(/\/$/, '')}/sendMedia`, {
			method: 'POST',
			headers: { authorization: `Bearer ${config.telegramRelaySecret}` },
			body: form
		})
		if (!res.ok) {
			console.error('telegram relay /sendMedia failed', res.status, await res.text())
			return { messageId: null, blocked: false }
		}
		return (await res.json()) as { messageId: number | null; blocked: boolean }
	} catch (err) {
		console.error('telegram relay /sendMedia error', err)
		return { messageId: null, blocked: false }
	}
}

// Fan a freshly-created message out to Telegram for every recipient who is
// offline (no live WS) AND has linked + enabled notifications. Recipients are the
// mentioned members for a channel message, or the other participant for a DM.
// The notification carries the full text (URLs preserved as bare clickable
// links, markdown stripped) AND any attachments — voice messages, images, video,
// files — forwarded via the matching Telegram send* method. Called
// fire-and-forget from createChannelMessage — must never throw into the send
// path.
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

	// resolve mentioned members' usernames so <@id> tokens decode to @name in
	// the body — only the actually-mentioned members, not the whole table
	const mentioned = mentionedIds(dto.content)
	const nameRows = mentioned.length
		? await db
				.select({ id: schema.members.id, username: schema.members.username })
				.from(schema.members)
				.where(inArray(schema.members.id, mentioned))
		: []
	// plainTextBody preserves URLs intact (stashed during markdown stripping)
	// so they stay clickable in Telegram's plain-text rendering
	const body = plainTextBody(dto.content, nameRows)
	const header =
		channel.kind === 'dm'
			? `Личное сообщение от ${dto.authorName}:`
			: `${dto.authorName} упомянул(а) вас в #${channel.name}:`
	const text = body ? `${header}\n${body}` : header

	// resolve attachment object keys (the DTO carries no objectKey — it is
	// server-only) so we can fetch + forward each attachment's bytes
	const attRows = dto.attachments.length
		? await db
				.select({
					id: schema.attachments.id,
					objectKey: schema.attachments.objectKey,
					filename: schema.attachments.filename,
					mime: schema.attachments.mime
				})
				.from(schema.attachments)
				.where(eq(schema.attachments.messageId, dto.id))
		: []
	const objectKeyById = new Map(attRows.map((r) => [r.id, r.objectKey]))
	// preserve the DTO's attachment order (that's what the chat renders)
	const mediaItems: TgMediaItem[] = []
	for (const a of dto.attachments) {
		const objectKey = objectKeyById.get(a.id)
		if (!objectKey) continue
		mediaItems.push({
			type: tgMediaType(a),
			filename: a.filename,
			objectKey,
			mime: a.mime
		})
	}

	const textFitsCaption = text.length > 0 && text.length <= TG_CAPTION_MAX

	for (const target of targets) {
		const record = (messageId: number) =>
			recordNotification({
				memberId: target.id,
				chatId: target.chatId!,
				telegramMessageId: messageId,
				channelId: channel.id
			})
		let blocked = false
		let textDelivered = false
		let mediaDelivered = false

		// 1. send text as its own message when there are no attachments to
		//    caption it on, or when it exceeds the caption limit
		if (text.length > 0 && (mediaItems.length === 0 || !textFitsCaption)) {
			const r = await tgSendMessage(target.chatId!, text)
			if (r.blocked) {
				await clearTelegramLink(target.id, true)
				continue
			}
			if (r.messageId != null) {
				await record(r.messageId)
				textDelivered = true
			}
		}

		// 2. forward each attachment; the first successful one carries the
		//    text as its caption (when it fits and the text wasn't already
		//    sent as its own message)
		for (const m of mediaItems) {
			const useCaption = !textDelivered && textFitsCaption
			const r = await tgSendMedia(target.chatId!, {
				type: m.type,
				caption: useCaption ? text : undefined,
				filename: m.filename,
				objectKey: m.objectKey,
				mime: m.mime
			})
			if (r.blocked) {
				await clearTelegramLink(target.id, true)
				blocked = true
				break
			}
			if (r.messageId != null) {
				await record(r.messageId)
				if (useCaption) textDelivered = true
				mediaDelivered = true
			}
		}
		if (blocked) continue

		// 3. the text never made it through (it was meant to ride as a caption
		//    on the first media item but every media send failed, or step 1's
		//    own sendMessage failed) — deliver it as its own message so the
		//    recipient still gets the content. When the message had attachments
		//    and none came through, append a note so they know.
		if (body.length > 0 && !textDelivered) {
			const note =
				mediaItems.length > 0 && !mediaDelivered ? '\n(вложение не удалось переслать)' : ''
			const r = await tgSendMessage(target.chatId!, text + note)
			if (r.blocked) {
				await clearTelegramLink(target.id, true)
				continue
			}
			if (r.messageId != null) {
				await record(r.messageId)
				textDelivered = true
			}
		}

		// 4. attachment-only message (no text) where there were attachments
		//    and every media send failed — send the header (who/where) plus the
		//    failure note so the recipient has context. The `mediaItems.length >
		//    0` guard is what makes this "attachment-only": without it, a
		//    marker-only message (e.g. "***") that plainTextBody strips to an
		//    empty body would fire this after step 1 already sent the header.
		//    No mapping row: a reply to this hint should not route into a channel.
		if (body.length === 0 && mediaItems.length > 0 && !mediaDelivered) {
			await tgSendMessage(target.chatId!, `${text}\n(не удалось переслать вложение)`)
		}
	}
}
