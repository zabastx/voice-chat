import { and, eq, gt } from 'drizzle-orm'

// Raw Telegram update, forwarded verbatim by the telegram-relay service, narrowed
// to the fields we use.
interface TgUpdate {
	message?: {
		text?: string
		chat?: { id: number }
		reply_to_message?: { message_id: number }
	}
}

const HINTS = {
	linked: '✅ Уведомления подключены. Отвечайте на сообщения бота, чтобы отправить ответ в чат.',
	badToken:
		'Ссылка недействительна или устарела. Откройте настройки в приложении и подключите Telegram заново.',
	howToLink:
		'Чтобы подключить уведомления, откройте настройки в приложении и нажмите «Подключить Telegram».',
	replyOnly: 'Ответьте на конкретное уведомление, чтобы отправить сообщение в чат.',
	mediaOnly: 'Пока можно отправлять только текст — вложения не поддерживаются.',
	expired:
		'Не удалось найти чат для этого уведомления — возможно, оно слишком старое. Ответьте на более свежее уведомление.'
}

export default defineEventHandler(async (event) => {
	const config = useRuntimeConfig()
	// authenticate the relay (shared bearer secret); mirrors the relay's own auth
	if (
		!config.telegramRelaySecret ||
		getHeader(event, 'authorization') !== `Bearer ${config.telegramRelaySecret}`
	) {
		throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
	}

	const update = await readBody<TgUpdate>(event)
	const message = update?.message
	const chatId = message?.chat?.id
	// ignore anything that isn't a chat message (edited_message, callbacks, …)
	if (!message || chatId == null) return { ok: true }
	const chat = String(chatId)
	const text = message.text?.trim()
	const db = useDb()

	// --- linking: /start <token> ---
	if (text?.startsWith('/start')) {
		const token = text.slice('/start'.length).trim()
		if (!token) {
			// bare /start (e.g. Telegram's persistent Start button on a returning user):
			// don't nag an already-linked chat to go link again
			const existing = await db.query.members.findFirst({
				where: eq(schema.members.telegramChatId, chat)
			})
			await tgSendMessage(chat, existing ? HINTS.linked : HINTS.howToLink)
			return { ok: true }
		}
		const [member] = await db
			.update(schema.members)
			.set({ telegramChatId: chat, telegramLinkToken: null, telegramLinkTokenExpiresAt: null })
			.where(
				and(
					eq(schema.members.telegramLinkToken, token),
					gt(schema.members.telegramLinkTokenExpiresAt, new Date())
				)
			)
			.returning()
		if (member) wsBroadcast({ type: 'member.updated', member: memberDto(member) })
		await tgSendMessage(chat, member ? HINTS.linked : HINTS.badToken)
		return { ok: true }
	}

	// --- reply-to-send ---
	const repliedTo = message.reply_to_message?.message_id
	if (repliedTo == null) {
		await tgSendMessage(chat, HINTS.replyOnly)
		return { ok: true }
	}
	if (!text) {
		// a reply, but carrying media/sticker rather than text
		await tgSendMessage(chat, HINTS.mediaOnly)
		return { ok: true }
	}

	const [mapping] = await db
		.select({
			memberId: schema.telegramNotifications.memberId,
			channelId: schema.telegramNotifications.channelId
		})
		.from(schema.telegramNotifications)
		.where(
			and(
				eq(schema.telegramNotifications.chatId, chat),
				eq(schema.telegramNotifications.telegramMessageId, repliedTo)
			)
		)
		.limit(1)
	if (!mapping) {
		await tgSendMessage(chat, HINTS.expired)
		return { ok: true }
	}

	const channel = await db.query.channels.findFirst({
		where: eq(schema.channels.id, mapping.channelId)
	})
	// channel gone (FK cascade would drop the mapping too, but stay defensive), or a
	// voice channel that carries no chat
	if (!channel || channel.kind === 'voice') {
		await tgSendMessage(chat, HINTS.expired)
		return { ok: true }
	}
	// re-check DM membership: never let a Telegram reply post into a DM the member
	// is no longer part of
	if (channel.kind === 'dm') {
		const participants = await channelParticipantIds(channel.id)
		if (!participants.includes(mapping.memberId)) {
			await tgSendMessage(chat, HINTS.expired)
			return { ok: true }
		}
	}

	const content = await encodeMessageMentions(text)
	await createChannelMessage({ channel, authorId: mapping.memberId, content, source: 'telegram' })
	return { ok: true }
})
