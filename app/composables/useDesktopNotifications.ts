// One desktop notification per message, over whichever path this client actually has.
//
// In a browser that is the Web Notification API. In a Desktop Client it cannot be: WebView2
// answers `Notification.requestPermission()` with `denied` without ever prompting, and a
// constructed notification fires `error` (GOTCHAS 31). So the Desktop Client's path is the
// Native Bridge's `notifications` capability, where the shell shows a Windows toast built
// from a bounded title and body and nothing else (adr/0013).
//
// Exactly one of the two runs, chosen once per document: whichever transport this client
// has is the only one asked, so a message never produces two notifications.
import { boundNotification } from '~~/shared/utils/native-bridge'

export type DesktopNotificationTransport = 'native' | 'web' | 'none'

/**
 * Whether this client may show a notification at all. `'granted'` in a Desktop Client
 * without asking anyone: the shell owns the operating system's side of that question, and
 * the member's own answer is the setting.
 */
export type DesktopNotificationState = 'granted' | 'denied' | 'default' | 'unsupported'

export interface DesktopNotification {
	/** who sent it — the toast's first line */
	title: string
	/** what they said — the toast's second line */
	body: string
	/**
	 * Which conversation this is about. In a browser it is both the click destination and
	 * the coalescing key, so a second message replaces the first rather than stacking. The
	 * Desktop Client's toast gets neither: the bridge contract carries no URL and no tag by
	 * design, so its notifications stack the way every other Windows toast does.
	 */
	channelId: string
	/** shown beside a browser notification; a Windows toast has no room in the contract */
	avatarUrl?: string
}

export function useDesktopNotifications() {
	const desktop = useNativeDesktop()
	const prefs = usePreferences()
	const transport = useState<DesktopNotificationTransport>('notify-transport', () => 'none')
	const state = useState<DesktopNotificationState>('notify-state', () => 'default')
	const resolved = useState('notify-resolved', () => false)

	if (import.meta.client && !resolved.value) {
		resolved.value = true
		if (desktop.supports('notifications')) {
			transport.value = 'native'
			state.value = 'granted'
		} else if ('Notification' in window) {
			transport.value = 'web'
			state.value = Notification.permission
		} else {
			transport.value = 'none'
			state.value = 'unsupported'
		}
	}

	/** The setting is on and this client can act on it. */
	const enabled = computed(() => prefs.value.desktopNotifications && state.value === 'granted')
	/** The member refused at the browser level, and only the browser can undo that. */
	const blocked = computed(() => state.value === 'denied')
	/** Nothing here can show a notification, so the setting has nothing to turn on. */
	const unsupported = computed(() => state.value === 'unsupported')

	/**
	 * Turns the setting on, asking the browser once if it has never answered. Returns
	 * whether notifications are now on, so the caller can explain why they are not.
	 */
	async function enable(): Promise<boolean> {
		// A member who already refused is not asked again: the browser resolves a refused
		// request without prompting, so re-asking would only look broken. The existing
		// «Уведомления заблокированы» state is what they see instead.
		if (state.value === 'denied' || transport.value === 'none') return false
		if (transport.value === 'web' && state.value !== 'granted') {
			state.value = await Notification.requestPermission()
			if (state.value !== 'granted') return false
		}
		prefs.value.desktopNotifications = true
		return true
	}

	function disable() {
		prefs.value.desktopNotifications = false
	}

	/** Shows one notification, or nothing at all. */
	function notify(notification: DesktopNotification) {
		if (!enabled.value) return
		// Bounded once, for both transports: the same message reads the same whether the
		// member is in a browser or in the Desktop Client.
		const bounded = boundNotification({ title: notification.title, body: notification.body })
		if (transport.value === 'native') {
			// The shell has the whole of it from here. Clicking a Windows toast does
			// nothing: the contract carries no URL, and the member opens the window from
			// the tray — the one place the two adapters genuinely differ.
			desktop.showNotification(bounded)
			return
		}
		if (transport.value !== 'web') return
		const shown = new Notification(bounded.title, {
			body: bounded.body,
			tag: notification.channelId,
			icon: notification.avatarUrl
		})
		shown.onclick = () => {
			window.focus()
			void navigateTo(`/channels/${notification.channelId}`)
			shown.close()
		}
	}

	return { transport, state, enabled, blocked, unsupported, enable, disable, notify }
}
