// Single entry point to the Native Bridge (adr/0013). Everything native the Web Release
// may reach lives behind the object this returns; the page never touches
// `window.voiceChatDesktop` directly, so validation cannot be skipped at a call site.
import { resolveNativeBridge, type NativeBridge } from '~~/shared/utils/native-bridge'

declare global {
	interface Window {
		/** Frozen descriptor injected by the Desktop Client. Absent in a browser. */
		voiceChatDesktop?: unknown
	}
}

// Resolved once per document: the descriptor is immutable, and re-reading it per call
// would only give page code more chances to be in the way. Deliberately not `useState` —
// the bridge holds functions, which no payload can carry across the SSR boundary. On the
// server this always memoizes the stateless browser adapter, so it carries nothing between
// requests; the client resolves its own on hydration.
let bridge: NativeBridge | undefined

export function useNativeDesktop(): NativeBridge {
	// During SSR there is no shell to talk to, so the browser adapter is the honest answer;
	// the client resolves the real one on hydration.
	if (!bridge)
		bridge = resolveNativeBridge(import.meta.client ? window.voiceChatDesktop : undefined)
	return bridge
}
