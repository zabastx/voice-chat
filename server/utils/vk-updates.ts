import { eq } from 'drizzle-orm'

// Incoming VK community events, from either transport — Bots Long Poll or the
// Callback API deliver byte-identical objects, verified on live data (adr/0011).
// Nothing here touches H3Event, so both callers share it unchanged.

export interface VkMessage {
	id?: number
	peer_id?: number
	from_id?: number
	text?: string
	conversation_message_id?: number
	// the deep-link token from vk.me/club<id>?ref=<token>; arrives on «Начать»
	ref?: string
	// service field for bots — the Start button sends {"command":"start"}
	payload?: string
	// the bot message this one replies to. VK documents it as a bare `object`
	// with no fields listed; measured to carry both id spaces, and a reply may
	// reference either, so both are passed to the lookup.
	reply_message?: {
		id?: number
		conversation_message_id?: number
	}
}

export interface VkUpdate {
	type?: string
	group_id?: number
	secret?: string
	object?: {
		message?: VkMessage
		// message_allow / message_deny
		user_id?: number
		key?: string
	}
}

const HINTS = {
	linked: '✅ Уведомления подключены. Отвечайте на сообщения бота, чтобы отправить ответ в чат.',
	badToken:
		'Ссылка недействительна или устарела. Откройте настройки в приложении и подключите VK заново.',
	howToLink:
		'Чтобы подключить уведомления, откройте настройки в приложении и нажмите «Подключить VK».',
	replyOnly: 'Ответьте на конкретное уведомление, чтобы отправить сообщение в чат.',
	mediaOnly: 'Пока можно отправлять только текст — вложения не поддерживаются.',
	expired:
		'Не удалось найти чат для этого уведомления — возможно, оно слишком старое. Ответьте на более свежее уведомление.'
}

// Never throws: the caller has already answered VK, and an unhandled rejection
// in a request handler would take the process down.
export async function handleVkUpdate(update: VkUpdate): Promise<void> {
	try {
		switch (update.type) {
			case 'message_new':
				await onMessageNew(update.object?.message)
				break
			case 'message_deny': {
				// VK pushes this the moment a member bars the community, so the
				// unlink is event-driven rather than waiting for a send to fail
				const userId = update.object?.user_id
				if (userId == null) break
				const memberId = await memberIdByExternalId('vk', String(userId))
				if (memberId) await clearLink(memberId, 'vk', true)
				break
			}
			default:
				break
		}
	} catch (err) {
		console.error(`vk update (${update.type}) failed`, err)
	}
}

async function onMessageNew(message: VkMessage | undefined) {
	const peerId = message?.peer_id
	if (!message || peerId == null) return
	const peer = String(peerId)
	const text = message.text?.trim()

	// --- linking ---
	// The token rides on `ref` from vk.me/club<id>?ref=<token>, delivered on the
	// «Начать» press alongside {"command":"start"}. Not on message_allow, whose
	// `key` is only populated by messages.allowMessagesFromGroup — a method that
	// needs a user token VK issues "in exceptional cases" (adr/0011).
	if (message.ref) {
		const memberId = await consumeLinkToken('vk', message.ref, peer)
		await vkSend(peer, memberId ? HINTS.linked : HINTS.badToken)
		return
	}

	// A Start press with no token (a returning member tapping «Начать» again):
	// don't nag someone who is already linked to go and link.
	if (isStartCommand(message.payload)) {
		const existing = await memberIdByExternalId('vk', peer)
		await vkSend(peer, existing ? HINTS.linked : HINTS.howToLink)
		return
	}

	// --- reply-to-send ---
	const reply = message.reply_message
	if (!reply) {
		await vkSend(peer, HINTS.replyOnly)
		return
	}
	if (!text) {
		await vkSend(peer, HINTS.mediaOnly)
		return
	}

	const target = await resolveReplyTarget('vk', peer, {
		messageId: reply.id,
		conversationMessageId: reply.conversation_message_id
	})
	if (!target) {
		await vkSend(peer, HINTS.expired)
		return
	}

	const channel = await useDb().query.channels.findFirst({
		where: eq(schema.channels.id, target.channelId)
	})
	// channel gone (the FK cascade would drop the mapping too, but stay
	// defensive), or a voice channel, which carries no chat
	if (!channel || channel.kind === 'voice') {
		await vkSend(peer, HINTS.expired)
		return
	}
	// re-check DM membership: never let a VK reply post into a DM the member is
	// no longer part of
	if (channel.kind === 'dm') {
		const participants = await channelParticipantIds(channel.id)
		if (!participants.includes(target.memberId)) {
			await vkSend(peer, HINTS.expired)
			return
		}
	}

	const content = await encodeMessageMentions(text)
	await createChannelMessage({
		channel,
		authorId: target.memberId,
		content,
		source: 'vk'
	})
}

function isStartCommand(payload: string | undefined): boolean {
	if (!payload) return false
	try {
		return (JSON.parse(payload) as { command?: string }).command === 'start'
	} catch {
		return false
	}
}
