import { config, requireRelayAuth } from '../utils/config'

interface SendBody {
	chatId: string
	text: string
}

// Proxy a single sendMessage to Telegram on behalf of the main app. Returns the
// sent message id (for reply routing) and whether the chat blocked the bot (403,
// so the main app can auto-unlink). Mirrors the old in-app tgSendMessage.
export default defineEventHandler(async (event) => {
	requireRelayAuth(event)
	const body = await readBody<SendBody>(event)
	if (!body?.chatId || typeof body.text !== 'string') {
		throw createError({ statusCode: 400, statusMessage: 'chatId and text required' })
	}
	try {
		const res = await fetch(`https://api.telegram.org/bot${config.botToken()}/sendMessage`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				chat_id: body.chatId,
				text: body.text,
				disable_web_page_preview: true
			})
		})
		if (res.status === 403) return { messageId: null, blocked: true }
		if (!res.ok) {
			console.error('sendMessage failed', res.status, await res.text())
			return { messageId: null, blocked: false }
		}
		const data = (await res.json()) as { result?: { message_id?: number } }
		return { messageId: data.result?.message_id ?? null, blocked: false }
	} catch (err) {
		console.error('sendMessage error', err)
		return { messageId: null, blocked: false }
	}
})
