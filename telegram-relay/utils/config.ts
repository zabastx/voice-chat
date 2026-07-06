import type { H3Event } from 'h3'

// All config comes from the environment; every value is required, so a missing
// one fails loudly at first use rather than silently no-oping.
function required(name: string): string {
	const value = process.env[name]
	if (!value) throw new Error(`telegram-relay: missing required env ${name}`)
	return value
}

export const config = {
	/** Bot token from @BotFather. */
	botToken: () => required('TELEGRAM_BOT_TOKEN'),
	/** Public HTTPS URL of THIS relay's webhook route, e.g. https://relay.example.com/telegram/webhook */
	webhookUrl: () => required('TELEGRAM_WEBHOOK_URL'),
	/** Secret Telegram echoes back in the X-Telegram-Bot-Api-Secret-Token header. */
	webhookSecret: () => required('TELEGRAM_WEBHOOK_SECRET'),
	/** Main app ingest endpoint, e.g. https://chat.example.com/api/telegram/ingest */
	ingestUrl: () => required('INGEST_URL'),
	/** Shared bearer secret authenticating both directions (main<->relay). */
	relaySecret: () => required('RELAY_SECRET')
}

// Bearer check for calls coming FROM the main app (POST /send).
export function requireRelayAuth(event: H3Event) {
	if (getHeader(event, 'authorization') !== `Bearer ${config.relaySecret()}`) {
		throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
	}
}
