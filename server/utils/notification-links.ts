import { and, eq, gt, inArray, isNotNull } from 'drizzle-orm'

// A member's binding to one messenger, and the token dance that establishes it.
// Every transport (Telegram, VK) uses these — the differences live in how each
// one delivers the token, not in how it is stored (adr/0011).
//
// `externalId` is a Telegram chat id or a VK peer id, and is a SECRET: it must
// never reach a member DTO or the session cookie. A VK peer id is the member's
// public VK user id, so leaking one deanonymises them.

export type NotificationTransport = 'telegram' | 'vk'

const TOKEN_TTL_MS = 15 * 60 * 1000

export interface NotificationLink {
	memberId: string
	transport: NotificationTransport
	externalId: string | null
	notificationsEnabled: boolean
}

// The caller's own link status for one transport. Absent row = never linked.
export async function getLink(
	memberId: string,
	transport: NotificationTransport
): Promise<NotificationLink | null> {
	const row = await useDb().query.memberNotificationLinks.findFirst({
		where: and(
			eq(schema.memberNotificationLinks.memberId, memberId),
			eq(schema.memberNotificationLinks.transport, transport)
		)
	})
	return row ?? null
}

// Members among `memberIds` who are reachable on this transport right now:
// linked AND with notifications left on. Used to pick notification recipients.
export async function reachableLinks(
	transport: NotificationTransport,
	memberIds: string[]
): Promise<Array<{ memberId: string; externalId: string }>> {
	if (memberIds.length === 0) return []
	const rows = await useDb()
		.select({
			memberId: schema.memberNotificationLinks.memberId,
			externalId: schema.memberNotificationLinks.externalId
		})
		.from(schema.memberNotificationLinks)
		.where(
			and(
				eq(schema.memberNotificationLinks.transport, transport),
				inArray(schema.memberNotificationLinks.memberId, memberIds),
				isNotNull(schema.memberNotificationLinks.externalId),
				eq(schema.memberNotificationLinks.notificationsEnabled, true)
			)
		)
	return rows.filter((r): r is { memberId: string; externalId: string } => r.externalId !== null)
}

// Mint a single-use deep-link token. Upserts, so re-opening the settings dialog
// replaces any outstanding token rather than leaving several usable at once.
export async function mintLinkToken(
	memberId: string,
	transport: NotificationTransport
): Promise<string> {
	const token = newToken()
	const expiresAt = new Date(Date.now() + TOKEN_TTL_MS)
	await useDb()
		.insert(schema.memberNotificationLinks)
		.values({ memberId, transport, linkToken: token, linkTokenExpiresAt: expiresAt })
		.onConflictDoUpdate({
			target: [schema.memberNotificationLinks.memberId, schema.memberNotificationLinks.transport],
			set: { linkToken: token, linkTokenExpiresAt: expiresAt }
		})
	return token
}

// Consume a token and bind the messenger account to the member it belongs to.
// Returns null when the token is unknown or expired — the caller answers with a
// "link expired" hint. Single-use: the token is cleared in the same statement,
// so a replayed token binds nothing.
export async function consumeLinkToken(
	transport: NotificationTransport,
	token: string,
	externalId: string
): Promise<string | null> {
	const [row] = await useDb()
		.update(schema.memberNotificationLinks)
		.set({ externalId, linkToken: null, linkTokenExpiresAt: null })
		.where(
			and(
				eq(schema.memberNotificationLinks.transport, transport),
				eq(schema.memberNotificationLinks.linkToken, token),
				gt(schema.memberNotificationLinks.linkTokenExpiresAt, new Date())
			)
		)
		.returning()
	if (!row) return null
	await broadcastMember(row.memberId)
	return row.memberId
}

// Which member owns this messenger account, if any.
export async function memberIdByExternalId(
	transport: NotificationTransport,
	externalId: string
): Promise<string | null> {
	const row = await useDb().query.memberNotificationLinks.findFirst({
		where: and(
			eq(schema.memberNotificationLinks.transport, transport),
			eq(schema.memberNotificationLinks.externalId, externalId)
		)
	})
	return row?.memberId ?? null
}

// Turn notifications on/off without unlinking, so the preference survives.
export async function setNotificationsEnabled(
	memberId: string,
	transport: NotificationTransport,
	enabled: boolean
) {
	await useDb()
		.insert(schema.memberNotificationLinks)
		.values({ memberId, transport, notificationsEnabled: enabled })
		.onConflictDoUpdate({
			target: [schema.memberNotificationLinks.memberId, schema.memberNotificationLinks.transport],
			set: { notificationsEnabled: enabled }
		})
	await broadcastMember(memberId)
}

// Sever a link. `disableNotifications` is set on auto-unlink (the messenger told
// us the member blocked the bot) so re-linking later doesn't resume firing into
// the void; a manual unlink leaves the preference untouched.
export async function clearLink(
	memberId: string,
	transport: NotificationTransport,
	disableNotifications = false
) {
	await useDb()
		.update(schema.memberNotificationLinks)
		.set({
			externalId: null,
			linkToken: null,
			linkTokenExpiresAt: null,
			...(disableNotifications ? { notificationsEnabled: false } : {})
		})
		.where(
			and(
				eq(schema.memberNotificationLinks.memberId, memberId),
				eq(schema.memberNotificationLinks.transport, transport)
			)
		)
	await broadcastMember(memberId)
}

// Every link state change moves a member's reachability badge, so the members
// panel has to hear about it (adr/0006's "Update" — the derived boolean is public).
async function broadcastMember(memberId: string) {
	const member = await useDb().query.members.findFirst({
		where: eq(schema.members.id, memberId)
	})
	if (member) wsBroadcast({ type: 'member.updated', member: await memberDto(member) })
}
