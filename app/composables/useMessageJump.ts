export interface PendingJump {
	channelId: string
	messageId: string
}

// Cross-page hand-off for "jump to this message" (search results → channel
// page). The channel page consumes and clears it once it reaches the target.
export function useMessageJump() {
	return useState<PendingJump | null>('chat-jump', () => null)
}
