// Bundle entry for desktop/shell-check.mjs: it builds this file and evaluates the result
// inside the real WebView2 so the same scenarios run against the real Tauri adapter.
import { runNativeBridgeContract } from './native-bridge-contract'

declare global {
	var __voiceChatBridgeContract: typeof runNativeBridgeContract | undefined
}

globalThis.__voiceChatBridgeContract = runNativeBridgeContract
