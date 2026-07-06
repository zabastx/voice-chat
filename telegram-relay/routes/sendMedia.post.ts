import { readFormData } from 'h3'

import { config, requireRelayAuth } from '../utils/config'

type TgMediaType = 'voice' | 'photo' | 'video' | 'document'

// each type maps to a Telegram send* method whose file part is named identically
// (voice/photo/video/document) — so the same key works for the method name and
// the multipart field
const METHODS: Record<TgMediaType, string> = {
	voice: 'sendVoice',
	photo: 'sendPhoto',
	video: 'sendVideo',
	document: 'sendDocument'
}

// Proxy a media send (sendVoice/sendPhoto/sendVideo/sendDocument) to Telegram on
// behalf of the main app. The app fetches the attachment bytes from S3 (the
// bucket is private; Telegram's servers can't reach it) and uploads them here as
// multipart; the relay re-packs the file under Telegram's expected field name
// (named after the method: voice/photo/video/document) and forwards to the
// matching send* method. Returns the sent message id (for reply routing) and
// whether the chat blocked the bot (403 → caller auto-unlinks) — mirrors /send's
// contract. The file is buffered in memory; acceptable at friend-group scale,
// streaming later.
export default defineEventHandler(async (event) => {
	requireRelayAuth(event)
	const form = await readFormData(event)
	const chatId = form.get('chatId')
	const type = form.get('type')
	const caption = form.get('caption')
	const file = form.get('file')
	if (
		typeof chatId !== 'string' ||
		typeof type !== 'string' ||
		!(type in METHODS) ||
		!(file instanceof File)
	) {
		throw createError({ statusCode: 400, statusMessage: 'chatId, type, and file required' })
	}
	const method = METHODS[type as TgMediaType]
	try {
		const tgForm = new FormData()
		tgForm.append('chat_id', chatId)
		if (typeof caption === 'string') tgForm.append('caption', caption)
		tgForm.append(type, file, file.name || 'file')
		const res = await fetch(`https://api.telegram.org/bot${config.botToken()}/${method}`, {
			method: 'POST',
			body: tgForm
		})
		if (res.status === 403) return { messageId: null, blocked: true }
		if (!res.ok) {
			console.error(`${method} failed`, res.status, await res.text())
			return { messageId: null, blocked: false }
		}
		const data = (await res.json()) as { result?: { message_id?: number } }
		return { messageId: data.result?.message_id ?? null, blocked: false }
	} catch (err) {
		console.error(`${method} error`, err)
		return { messageId: null, blocked: false }
	}
})
