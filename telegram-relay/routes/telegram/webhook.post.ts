import { config } from '../../utils/config'

// Telegram delivers updates here. We verify the secret it echoes back in the
// X-Telegram-Bot-Api-Secret-Token header (the value we passed as secret_token to
// setWebhook), then forward the raw update to the main app's ingest endpoint
// (which owns all the linking/reply logic). If the main app is unreachable we
// return 502 so Telegram retries later rather than dropping the update.
export default defineEventHandler(async (event) => {
	if (getHeader(event, 'x-telegram-bot-api-secret-token') !== config.webhookSecret()) {
		throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
	}
	const update = await readBody(event)
	const res = await fetch(config.ingestUrl(), {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			authorization: `Bearer ${config.relaySecret()}`
		},
		body: JSON.stringify(update)
	}).catch((err) => {
		console.error('forward to ingest failed', err)
		return null
	})
	if (!res || !res.ok) {
		throw createError({ statusCode: 502, statusMessage: 'ingest unavailable' })
	}
	return { ok: true }
})
