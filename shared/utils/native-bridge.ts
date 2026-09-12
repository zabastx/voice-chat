// The Web Release's half of the Native Bridge (adr/0013). The Desktop Client freezes a
// descriptor onto the remote page; everything the page is allowed to do with the native
// shell goes through the small interface built here, and nothing else.
//
// Two rules make this safe to hand a remote origin:
//   1. Every reverse operation is named and validated here — there is no generic call.
//   2. An absent, older or broken descriptor degrades to the browser adapter, so chat and
//      voice keep working in a plain browser and in a Desktop Client that predates the
//      capability being asked about.

/**
 * Every capability this Web Release knows how to use. A Desktop Client may declare more;
 * the extras are dropped rather than trusted, so a newer shell cannot widen what the page
 * believes it may do.
 */
export const NATIVE_CAPABILITIES = ['voice-lifecycle', 'notifications', 'window-focus'] as const

export type NativeCapability = (typeof NATIVE_CAPABILITIES)[number]

/**
 * All a bridge notification may carry: two short lines of plain text. No tag, no icon, no
 * action and no URL — a toast the shell puts on the member's desktop must never become a
 * way for the page to aim a click somewhere (adr/0013). The shell measures the same bounds
 * again on arrival; the two copies are the point, not a duplication to collapse.
 */
export const NOTIFICATION_TITLE_LIMIT = 80
export const NOTIFICATION_BODY_LIMIT = 160

export interface NativeNotification {
	readonly title: string
	readonly body: string
}

export interface NativeBridgeDescriptor {
	readonly desktopVersion: string
	readonly bridgeVersion: number
	readonly capabilities: readonly NativeCapability[]
}

export interface NativeBridge {
	/** `null` in a browser; a frozen descriptor inside a Desktop Client. */
	readonly descriptor: NativeBridgeDescriptor | null
	readonly isDesktop: boolean
	/** Feature detection. Hide the matching affordance when this is `false`. */
	supports(capability: NativeCapability): boolean
	/**
	 * Tells the shell whether a Voice Channel is live, so it can postpone an update
	 * instead of restarting mid-call. Purely a lifecycle signal — it reaches no updater,
	 * window, shell or filesystem authority.
	 */
	setVoiceActive(active: boolean): void
	/**
	 * Asks the shell to show one bounded desktop notification. Returns whether the shell
	 * took it: `false` in every browser, and `false` from a Desktop Client that did not
	 * declare the capability or whose shell refused. There is no fallback to answer it
	 * with — the Web Notification API is dead inside a Desktop Client (GOTCHAS 31) — so a
	 * caller has nothing to do with a `false` but stay quiet; it exists so "the shell has
	 * it" and "nothing happened" are not the same answer. Over-long text is trimmed rather
	 * than refused — a long message is ordinary — but a notification with no title is a
	 * caller bug and throws.
	 */
	showNotification(notification: NativeNotification): boolean
	/**
	 * Whether the member can actually see the app window. Only meaningful while
	 * `window-focus` is supported: a Desktop Client hidden in the tray still answers
	 * `document.hasFocus()` with `true`, so inside one the page cannot work this out for
	 * itself (GOTCHAS 30).
	 */
	isForeground(): boolean
	/** Subscribes to `isForeground` changes. Returns the unsubscribe. */
	onForegroundChange(listener: (foreground: boolean) => void): () => void
}

// Version strings cross into a native log line, so keep them to the characters a semver
// can actually contain instead of accepting arbitrary page-controlled text.
const VERSION_PATTERN = /^[0-9A-Za-z.+-]{1,64}$/

function readDescriptor(candidate: unknown): NativeBridgeDescriptor | null {
	if (typeof candidate !== 'object' || candidate === null) return null
	const source = candidate as Record<string, unknown>

	const desktopVersion = source.desktopVersion
	if (typeof desktopVersion !== 'string' || !VERSION_PATTERN.test(desktopVersion)) return null

	const bridgeVersion = source.bridgeVersion
	if (typeof bridgeVersion !== 'number' || !Number.isInteger(bridgeVersion) || bridgeVersion < 1) {
		return null
	}

	const declared = source.capabilities
	if (!Array.isArray(declared)) return null
	const capabilities = NATIVE_CAPABILITIES.filter((known) => declared.includes(known))

	return Object.freeze({
		desktopVersion,
		bridgeVersion,
		capabilities: Object.freeze(capabilities)
	})
}

function requireBoolean(active: boolean): void {
	if (typeof active !== 'boolean') {
		throw new TypeError('setVoiceActive принимает только boolean')
	}
}

// A toast is one line of plain text. Folding every run of whitespace and control
// characters into a single space — newlines included — means the page and the shell bound
// the same string, and leaves the shell nothing to escape.
//
// Cut by code point, not by `slice`: an emoji is two UTF-16 units, so slicing at the limit
// can leave half of one behind. A lone surrogate makes `encodeURIComponent` throw when the
// descriptor builds the bridge URL, which would drop the notification without a word — and
// it counts the way the shell counts, which measures `chars()`.
function bounded(text: string, limit: number): string {
	return [...text.replace(/[\s\p{Cc}]+/gu, ' ').trim()].slice(0, limit).join('').trim()
}

/**
 * Trims one notification to what a bridge notification may carry. Exported because the
 * Web Notification path has to show the very same two lines: a member who moves between
 * a browser and a Desktop Client should not see two different notifications for one
 * message. Throws on a notification with no title, which is a caller bug either way.
 */
export function boundNotification(notification: NativeNotification): NativeNotification {
	if (typeof notification !== 'object' || notification === null) {
		throw new TypeError('showNotification принимает объект {title, body}')
	}
	const { title, body } = notification as unknown as Record<string, unknown>
	if (typeof title !== 'string' || typeof body !== 'string') {
		throw new TypeError('title и body уведомления должны быть строками')
	}
	const boundedTitle = bounded(title, NOTIFICATION_TITLE_LIMIT)
	if (boundedTitle.length === 0) throw new TypeError('уведомление без заголовка')
	return { title: boundedTitle, body: bounded(body, NOTIFICATION_BODY_LIMIT) }
}

function requireListener(listener: (foreground: boolean) => void): void {
	if (typeof listener !== 'function') {
		throw new TypeError('onForegroundChange принимает функцию')
	}
}

const browserBridge: NativeBridge = Object.freeze({
	descriptor: null,
	isDesktop: false,
	supports: () => false,
	setVoiceActive(active: boolean) {
		// Validated the same way as the desktop adapter, then dropped: a payload bug
		// surfaces in the browser too, where it is cheap to find, instead of only on a
		// member's Windows machine.
		requireBoolean(active)
	},
	showNotification(notification: NativeNotification) {
		boundNotification(notification)
		return false
	},
	// A browser page knows its own focus, so nothing consults these without the capability.
	isForeground: () => true,
	onForegroundChange(listener: (foreground: boolean) => void) {
		requireListener(listener)
		return () => {}
	}
})

/**
 * Turns whatever the Desktop Client left on the page into a bridge. Anything that does
 * not validate — missing, malformed, or an unusable version — becomes the browser adapter.
 */
export function resolveNativeBridge(candidate: unknown): NativeBridge {
	const descriptor = readDescriptor(candidate)
	if (!descriptor) return browserBridge
	const source = candidate as Record<string, unknown>

	const supports = (capability: NativeCapability) => descriptor.capabilities.includes(capability)

	// Registered explicitly, one operation at a time: a capability gate, a payload check,
	// and a shell failure that stops here rather than breaking a call. The boolean reports
	// whether the shell actually took the operation.
	const call = (capability: NativeCapability, operation: string, payload: unknown): boolean => {
		if (!supports(capability)) return false
		const native = source[operation]
		if (typeof native !== 'function') return false
		try {
			;(native as (value: unknown) => void).call(source, payload)
			return true
		} catch {
			// the shell is a nice-to-have; the Web Release keeps running without it
			return false
		}
	}

	return Object.freeze({
		descriptor,
		isDesktop: true,
		supports,
		setVoiceActive(active: boolean) {
			requireBoolean(active)
			call('voice-lifecycle', 'setVoiceActive', active)
		},
		showNotification(notification: NativeNotification) {
			return call('notifications', 'showNotification', boundNotification(notification))
		},
		isForeground() {
			if (!supports('window-focus')) return true
			const native = source.isForeground
			if (typeof native !== 'function') return true
			try {
				// Anything but an explicit `false` reads as "the member is looking", which
				// errs towards one notification too few rather than one too many.
				return (native as () => unknown).call(source) !== false
			} catch {
				return true
			}
		},
		onForegroundChange(listener: (foreground: boolean) => void) {
			requireListener(listener)
			if (!supports('window-focus')) return () => {}
			const native = source.onForegroundChange
			if (typeof native !== 'function') return () => {}
			try {
				const unsubscribe = (native as (value: unknown) => unknown).call(
					source,
					(foreground: unknown) => listener(foreground !== false)
				)
				if (typeof unsubscribe !== 'function') return () => {}
				return () => {
					try {
						;(unsubscribe as () => void)()
					} catch {
						// a shell that cannot forget a listener is no reason to break the page
					}
				}
			} catch {
				return () => {}
			}
		}
	})
}
