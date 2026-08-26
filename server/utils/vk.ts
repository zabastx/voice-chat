// VK notifications — transport-neutral update handling (see adr/0011).
//
// STUB: the route and the event plumbing are real; linking, reply routing and sending are not
// built yet. Everything below is deliberately free of `H3Event` so the same handler serves the
// Callback API route and a future Bots Long Poll loop — dev.vk.ru specifies, and the 2026-08-26
// spike confirmed on live data, that both transports deliver identical event objects.

// A community event. Narrowed to what we will actually read; VK sends more.
export interface VkUpdate {
	type?: string
	group_id?: number
	secret?: string
	object?: {
		// message_new (API ≥ 5.103 nests the message; older versions put it on `object` itself)
		message?: VkMessage
		// message_allow / message_deny
		user_id?: number
		key?: string
	}
}

export interface VkMessage {
	id?: number
	peer_id?: number
	from_id?: number
	text?: string
	conversation_message_id?: number
	// the deep-link token from vk.me/club<id>?ref=<token>; arrives on the «Начать» press
	ref?: string
	// service field for bots — the Start button sends {"command":"start"}
	payload?: string
	// the bot message this one replies to. Undocumented shape; verified on 2026-08-26 to carry
	// both id spaces, so a reply can be matched against either (adr/0011).
	reply_message?: {
		id?: number
		conversation_message_id?: number
		peer_id?: number
		from_id?: number
	}
}

export function vkConfigured(): boolean {
	const config = useRuntimeConfig()
	return Boolean(config.vkConfirmationCode)
}

// Called after the transport has already answered VK. Must never throw into the caller: an
// unhandled rejection in a request handler takes the process down, and VK re-delivers anything
// that did not get an `ok` — so a thrown error becomes a retry storm.
export async function handleVkUpdate(update: VkUpdate): Promise<void> {
	const message = update.object?.message
	switch (update.type) {
		case 'message_new':
			// TODO(adr/0011): linking (bind `ref` to the Member) and reply-to-send (resolve
			// reply_message against the notification mapping, then createChannelMessage).
			console.log(
				`[vk] message_new peer=${message?.peer_id} cmid=${message?.conversation_message_id}` +
					`${message?.ref ? ` ref=${message.ref}` : ''}` +
					`${message?.reply_message ? ' (reply)' : ''}`
			)
			break
		case 'message_deny':
			// TODO(adr/0011): auto-unlink. VK pushes this when the Member bans community messages,
			// so unlinking can be event-driven instead of waiting for a send to fail with 901.
			console.log(`[vk] message_deny user=${update.object?.user_id}`)
			break
		case 'message_allow':
			// Consent signal only — `key` arrives empty unless messages.allowMessagesFromGroup was
			// used, which needs a user token we cannot get. The token comes from `ref` above.
			console.log(`[vk] message_allow user=${update.object?.user_id}`)
			break
		default:
			break
	}
	return Promise.resolve()
}
