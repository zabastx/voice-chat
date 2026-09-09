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
export const NATIVE_CAPABILITIES = ['voice-lifecycle'] as const

export type NativeCapability = (typeof NATIVE_CAPABILITIES)[number]

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

const browserBridge: NativeBridge = Object.freeze({
	descriptor: null,
	isDesktop: false,
	supports: () => false,
	setVoiceActive(active: boolean) {
		// Validated the same way as the desktop adapter, then dropped: a payload bug
		// surfaces in the browser too, where it is cheap to find, instead of only on a
		// member's Windows machine.
		requireBoolean(active)
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
	// and a shell failure that stops here rather than breaking a call.
	const call = (capability: NativeCapability, operation: string, payload: unknown) => {
		if (!supports(capability)) return
		const native = source[operation]
		if (typeof native !== 'function') return
		try {
			;(native as (value: unknown) => void).call(source, payload)
		} catch {
			// the shell is a nice-to-have; the Web Release keeps running without it
		}
	}

	return Object.freeze({
		descriptor,
		isDesktop: true,
		supports,
		setVoiceActive(active: boolean) {
			requireBoolean(active)
			call('voice-lifecycle', 'setVoiceActive', active)
		}
	})
}
