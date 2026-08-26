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
	await clearLink(memberId, 'telegram', disableNotifications)
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

// Telegram maps the app's media kinds onto its own send methods, so a voice
// message plays inline with a waveform rather than arriving as a file.
const TG_METHOD: Record<NotificationMediaKind, TgMediaItem['type']> = {
	voice: 'voice',
	image: 'photo',
	video: 'video',
	file: 'document'
}

// Delivery for one recipient. Telegram's quirk is that text and media are
// separate messages, and a caption is capped far below a message body — so a
// notification can take several messages, each of which gets its own mapping
// row. VK, by contrast, sends the lot in one call (adr/0011).
async function deliver(chatId: string, payload: NotificationPayload): Promise<DeliveryResult> {
	const text = payload.text ? `${payload.header}\n${payload.text}` : payload.header
	const media = payload.media
	const delivered: DeliveredMessage[] = []
	const textFitsCaption = text.length > 0 && text.length <= TG_CAPTION_MAX
	let textDelivered = false
	let mediaDelivered = false

	// 1. send text as its own message when there is no attachment to caption it
	//    on, or when it exceeds the caption limit
	if (text.length > 0 && (media.length === 0 || !textFitsCaption)) {
		const r = await tgSendMessage(chatId, text)
		if (r.blocked) return { delivered, blocked: true }
		if (r.messageId != null) {
			delivered.push({ messageId: r.messageId })
			textDelivered = true
		}
	}

	// 2. forward each attachment; the first successful one carries the text as
	//    its caption (when it fits and wasn't already sent as its own message)
	for (const m of media) {
		const useCaption = !textDelivered && textFitsCaption
		const r = await tgSendMedia(chatId, {
			type: TG_METHOD[m.kind],
			caption: useCaption ? text : undefined,
			filename: m.filename,
			objectKey: m.objectKey,
			mime: m.mime
		})
		if (r.blocked) return { delivered, blocked: true }
		if (r.messageId != null) {
			delivered.push({ messageId: r.messageId })
			if (useCaption) textDelivered = true
			mediaDelivered = true
		}
	}

	// 3. the text never made it through (it was meant to ride as a caption on
	//    the first attachment but every media send failed, or step 1's own
	//    sendMessage failed) — deliver it as its own message so the recipient
	//    still gets the content, noting the attachment that didn't come through.
	if (payload.text.length > 0 && !textDelivered) {
		const note = media.length > 0 && !mediaDelivered ? '\n(вложение не удалось переслать)' : ''
		const r = await tgSendMessage(chatId, text + note)
		if (r.blocked) return { delivered, blocked: true }
		if (r.messageId != null) delivered.push({ messageId: r.messageId })
	}

	// 4. attachment-only message where every media send failed — send the
	//    header plus the note so the recipient still has context. The
	//    `media.length > 0` guard is what makes this "attachment-only": without
	//    it, a marker-only message (e.g. "***") that plainTextBody strips to an
	//    empty body would fire this after step 1 already sent the header.
	//    Deliberately unmapped: a reply to a hint must not route into a channel.
	if (payload.text.length === 0 && media.length > 0 && !mediaDelivered) {
		await tgSendMessage(chatId, `${text}\n(не удалось переслать вложение)`)
	}

	return { delivered, blocked: false }
}

// Called from server/plugins/notifications.ts at boot. Explicit rather than a
// top-level side effect: auto-imported modules only evaluate when something
// happens to reference them, which is far too late for a transport registry.
export function registerTelegramTransport() {
	registerNotificationTransport({
		transport: 'telegram',
		configured: telegramConfigured,
		deliver
	})
}
