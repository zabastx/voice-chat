import type { H3Event } from 'h3'

import { NOTIFICATION_TRANSPORTS } from '../../shared/utils/notification-transports'

// Per-transport specifics the generic endpoints and the settings UI need. Adding
// a messenger means adding an entry here plus its transport implementation —
// nothing in the routes or the client is written per messenger (adr/0011).

export interface TransportInfo {
	transport: NotificationTransport
	// shown as the section title in settings
	label: string
	// iconify name for the connect button and the reachability badge
	icon: string
	configured: boolean
	// the deep link a member opens to link, with the minted token embedded
	deepLink(token: string): string | null
}

export function transportInfo(transport: NotificationTransport): TransportInfo {
	const config = useRuntimeConfig()
	if (transport === 'telegram') {
		const bot = config.public.telegramBotUsername
		return {
			transport,
			label: 'Telegram',
			icon: 'i-simple-icons-telegram',
			configured: telegramConfigured() && !!bot,
			deepLink: (token) => (bot ? `https://t.me/${bot}?start=${token}` : null)
		}
	}
	// the deep link is built server-side, so the public copy is only a convenience;
	// fall back to the private one rather than reporting configured with a null link
	const groupId = config.public.vkGroupId || config.vkGroupId
	return {
		transport,
		label: 'VK',
		icon: 'i-simple-icons-vk',
		configured: vkConfigured() && !!groupId,
		// `ref` comes back on the «Начать» press; the community must have the
		// «Добавить кнопку "Начать"» toggle on for that to be one tap
		deepLink: (token) => (groupId ? `https://vk.me/club${groupId}?ref=${token}` : null)
	}
}

export function isTransport(value: string): value is NotificationTransport {
	return (NOTIFICATION_TRANSPORTS as readonly string[]).includes(value)
}

// Validates the [transport] route segment, so an unknown one 404s rather than
// reaching the DB with a bogus enum value.
export function requireTransport(event: H3Event): NotificationTransport {
	const raw = getRouterParam(event, 'transport') ?? ''
	if (!isTransport(raw)) {
		throw createError({ statusCode: 404, message: 'Неизвестный транспорт уведомлений' })
	}
	return raw
}
