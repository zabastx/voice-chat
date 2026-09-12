// Bundle entry for desktop/shell-check.mjs: it builds this file and evaluates the result
// inside the real WebView2 so the same scenarios run against the real Tauri adapter.
import { NOTIFICATION_BODY_LIMIT, NOTIFICATION_TITLE_LIMIT } from '../shared/utils/native-bridge'
import { runNativeBridgeContract } from './native-bridge-contract'

declare global {
	var __voiceChatBridgeContract: typeof runNativeBridgeContract | undefined
	/**
	 * What this Web Release believes a notification may carry. The shell check sends a
	 * notification of exactly this size through the real bridge: the shell measures the
	 * same bounds in Rust, and a shell that refused one would mean the two copies had
	 * drifted apart.
	 */
	var __voiceChatNotificationLimits: { title: number; body: number } | undefined
}

globalThis.__voiceChatBridgeContract = runNativeBridgeContract
globalThis.__voiceChatNotificationLimits = {
	title: NOTIFICATION_TITLE_LIMIT,
	body: NOTIFICATION_BODY_LIMIT
}
