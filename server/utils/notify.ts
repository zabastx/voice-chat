import { and, eq, inArray } from 'drizzle-orm'

// Out-of-band notifications for members who aren't looking at the app.
//
// This module owns everything that is the same whatever messenger carries the
// message: who gets notified, what the notification says, and how a delivered
// message is recorded so a reply can be routed back. A transport owns only the
// delivery itself (adr/0011). Splitting it this way is what keeps the risk from
// ADR 0006 contained — one send path, one audience calculation, one mapping
// table, however many messengers.

// Kinds are described in the app's own terms, not any messenger's method names:
// each transport maps them onto whatever it has (Telegram sendVoice/sendPhoto…,
// VK's audio_message/photo/doc upload servers).
export type NotificationMediaKind = 'voice' | 'image' | 'video' | 'file'

export interface NotificationMedia {
	kind: NotificationMediaKind
	filename: string
	objectKey: string
	mime: string
}

// The channel a notification is about. Written out inline in two signatures
// before; it is one concept, so it gets one name.
export interface NotifyChannel {
	id: string
	kind: 'text' | 'voice' | 'dm'
	name: string
}

export interface NotificationPayload {
	// full body, already mention-decoded and markdown-stripped, URLs intact
	text: string
	// the "who said what where" line; sent alone when the body is empty
	header: string
	media: NotificationMedia[]
}

// What a transport reports back for one recipient. Every delivered message gets
// a mapping row, so a reply to any of them routes; `blocked` means the member
// has barred the bot and should be auto-unlinked.
// At least one id must be set. Telegram always has `messageId`; VK usually has
// both, but its docs warn the common message id "may be absent in some cases",
// and a cmid-only delivery must still be recorded — dropping it is what would
// make the reply unroutable, which is the whole reason both are stored.
export type DeliveredMessage =
	| { messageId: number; conversationMessageId?: number }
	| { messageId?: undefined; conversationMessageId: number }

export interface DeliveryResult {
	delivered: DeliveredMessage[]
	blocked: boolean
}

export interface NotificationTransportImpl {
	transport: NotificationTransport
	configured(): boolean
	deliver(externalId: string, payload: NotificationPayload): Promise<DeliveryResult>
}

// Registered transports. Order is delivery order for a member linked to more
// than one; each is independent, and one failing never stops the others.
const transports: NotificationTransportImpl[] = []

export function registerNotificationTransport(impl: NotificationTransportImpl) {
	if (!transports.some((t) => t.transport === impl.transport)) transports.push(impl)
}

// Fan a freshly-created message out to every recipient who is offline (no live
// WS) AND reachable on at least one transport. Recipients are the mentioned
// members for a text channel, or the other participant for a DM. Called
// fire-and-forget from createChannelMessage — must never throw into the send
// path, so every transport is isolated behind its own catch.
export async function notifyOffline(channel: NotifyChannel, dto: MessageDto) {
	const active = transports.filter((t) => t.configured())
	if (active.length === 0) return

	// voice channels carry no chat; only text channels and DMs notify
	let recipientIds: string[]
	if (channel.kind === 'dm') {
		recipientIds = (await channelParticipantIds(channel.id)).filter((id) => id !== dto.authorId)
	} else if (channel.kind === 'text') {
		recipientIds = mentionedIds(dto.content).filter((id) => id !== dto.authorId)
	} else {
		return
	}
	if (recipientIds.length === 0) return

	// offline = no live WS connection right now; an online member already saw it
	const online = new Set(wsOnline())
	const offlineIds = recipientIds.filter((id) => !online.has(id))
	if (offlineIds.length === 0) return

	const payload = await buildPayload(channel, dto)

	for (const impl of active) {
		try {
			const targets = await reachableLinks(impl.transport, offlineIds)
			for (const target of targets) {
				const result = await impl.deliver(target.externalId, payload)
				if (result.blocked) {
					await clearLink(target.memberId, impl.transport, true)
					continue
				}
				for (const msg of result.delivered) {
					await recordMapping({
						transport: impl.transport,
						memberId: target.memberId,
						externalChatId: target.externalId,
						messageId: msg.messageId ?? null,
						conversationMessageId: msg.conversationMessageId ?? null,
						channelId: channel.id
					})
				}
			}
		} catch (err) {
			console.error(`notifyOffline: ${impl.transport} transport failed`, err)
		}
	}
}

// The notification's content, built once and reused for every recipient and
// every transport.
async function buildPayload(channel: NotifyChannel, dto: MessageDto): Promise<NotificationPayload> {
	const db = useDb()
	// resolve mentioned members' usernames so <@id> tokens decode to @name —
	// only the actually-mentioned members, not the whole table
	const mentioned = mentionedIds(dto.content)
	const nameRows = mentioned.length
		? await db
				.select({ id: schema.members.id, username: schema.members.username })
				.from(schema.members)
				.where(inArray(schema.members.id, mentioned))
		: []
	// plainTextBody preserves URLs intact (stashed during markdown stripping) so
	// they stay clickable wherever the messenger renders plain text
	const text = plainTextBody(dto.content, nameRows)
	const header =
		channel.kind === 'dm'
			? `Личное сообщение от ${dto.authorName}:`
			: `${dto.authorName} упомянул(а) вас в #${channel.name}:`

	// the DTO carries no objectKey (it is server-only), so resolve the keys we
	// need to fetch each attachment's bytes
	const attRows = dto.attachments.length
		? await db
				.select({
					id: schema.attachments.id,
					objectKey: schema.attachments.objectKey,
					filename: schema.attachments.filename,
					mime: schema.attachments.mime
				})
				.from(schema.attachments)
				.where(eq(schema.attachments.messageId, dto.id))
		: []
	const objectKeyById = new Map(attRows.map((r) => [r.id, r.objectKey]))
	// preserve the DTO's attachment order — that's what the chat renders
	const media: NotificationMedia[] = []
	for (const a of dto.attachments) {
		const objectKey = objectKeyById.get(a.id)
		if (!objectKey) continue
		media.push({ kind: mediaKind(a), filename: a.filename, objectKey, mime: a.mime })
	}

	return { text, header, media }
}

// The app's own recorded clips are voice messages; everything else is typed off
// its mime. Transports decide what that means for them.
function mediaKind(att: { filename: string; mime: string }): NotificationMediaKind {
	if (att.filename.startsWith('voice-message-')) return 'voice'
	if (att.mime.startsWith('image/')) return 'image'
	if (att.mime.startsWith('video/')) return 'video'
	return 'file'
}

async function recordMapping(opts: {
	transport: NotificationTransport
	memberId: string
	externalChatId: string
	messageId: number | null
	conversationMessageId: number | null
	channelId: string
}) {
	await useDb()
		.insert(schema.notificationMappings)
		.values({
			id: newId(),
			transport: opts.transport,
			memberId: opts.memberId,
			externalChatId: opts.externalChatId,
			externalMessageId: opts.messageId,
			conversationMessageId: opts.conversationMessageId,
			channelId: opts.channelId
		})
		// a resent id would mean the messenger reused one; keep the first mapping
		.onConflictDoNothing()
}

// Resolve an incoming reply back to the channel and member it belongs to.
// VK may reference either id space, so both are tried (adr/0011).
export async function resolveReplyTarget(
	transport: NotificationTransport,
	externalChatId: string,
	ids: { messageId?: number; conversationMessageId?: number }
): Promise<{ memberId: string; channelId: string } | null> {
	const db = useDb()
	const lookups = []
	if (ids.messageId != null) {
		lookups.push(
			and(
				eq(schema.notificationMappings.transport, transport),
				eq(schema.notificationMappings.externalChatId, externalChatId),
				eq(schema.notificationMappings.externalMessageId, ids.messageId)
			)
		)
	}
	if (ids.conversationMessageId != null) {
		lookups.push(
			and(
				eq(schema.notificationMappings.transport, transport),
				eq(schema.notificationMappings.externalChatId, externalChatId),
				eq(schema.notificationMappings.conversationMessageId, ids.conversationMessageId)
			)
		)
	}
	for (const where of lookups) {
		const [row] = await db
			.select({
				memberId: schema.notificationMappings.memberId,
				channelId: schema.notificationMappings.channelId
			})
			.from(schema.notificationMappings)
			.where(where)
			.limit(1)
		if (row) return row
	}
	return null
}
