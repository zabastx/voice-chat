// VK Callback API endpoint (adr/0011). VK POSTs every community event here.
//
// Unlike the Telegram bridge, nothing sits in front of this: VK's servers reach the app directly,
// so `secret` in the body is the only authentication of the caller — the URL itself is not one.
//
// Register it at Управление → Работа с API → Callback API. Two independent steps, and the first
// succeeds with the second empty (GOTCHAS 21): confirm the address, THEN tick the event types on
// the Callback tab — the Long Poll tab's ticks do not carry over.
export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig()
	if (!vkConfigured()) {
		throw createError({ statusCode: 404, message: 'VK-уведомления не настроены' })
	}

	const update = await readBody<VkUpdate>(event)

	// The secret is configured on our side and echoed by VK in every notification. Check it before
	// anything else, including the handshake — VK sends it there too once it is set.
	if (config.vkCallbackSecret && update?.secret !== config.vkCallbackSecret) {
		throw createError({ statusCode: 403, message: 'Неверный секрет' })
	}

	// Handshake: VK expects the bare confirmation string, not JSON. The string rotates, so it is
	// config rather than a constant; groups.getCallbackConfirmationCode returns the current one.
	if (update?.type === 'confirmation') {
		setResponseHeader(event, 'content-type', 'text/plain')
		return config.vkConfirmationCode
	}

	// Answer first, work after. VK retries anything that is not a prompt `ok`
	// (10 s / 3 min / 10 min / 30 min / 1 h), so slow handling turns into duplicate deliveries —
	// hence fire-and-forget, the same contract `notifyOffline` uses on the send side.
	handleVkUpdate(update).catch((err) => console.error('vk update handling failed', err))
	setResponseHeader(event, 'content-type', 'text/plain')
	return 'ok'
})
