import { config } from '../utils/config'

// Point Telegram at this relay's webhook on boot. Idempotent: setWebhook just
// stores the URL, so re-registering every start is harmless.
export default defineNitroPlugin(async () => {
	try {
		const res = await fetch(`https://api.telegram.org/bot${config.botToken()}/setWebhook`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				url: config.webhookUrl(),
				secret_token: config.webhookSecret(),
				allowed_updates: ['message']
			})
		})
		const data = (await res.json().catch(() => null)) as {
			ok?: boolean
			description?: string
		} | null
		if (data?.ok) console.log('[relay] telegram webhook registered ->', config.webhookUrl())
		else console.error('[relay] setWebhook failed', res.status, data?.description)
	} catch (err) {
		console.error('[relay] setWebhook error', err)
	}
})
