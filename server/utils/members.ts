import { and, eq, inArray, isNotNull } from 'drizzle-orm'

interface MemberRow {
	id: string
	username: string
	displayName: string | null
	avatarId: string | null
	role: Role
	createdAt: Date
}

function base(row: MemberRow, telegramNotifications: boolean): MemberDto {
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		avatarUrl: row.avatarId ? `/api/members/${row.id}/avatar?v=${row.avatarId}` : null,
		role: row.role,
		createdAt: row.createdAt.toISOString(),
		telegramNotifications
	}
}

// Reachability used to be derivable from the member row itself; since adr/0011
// the links live in their own table, so building a DTO costs a lookup. Use
// memberDtos() for lists — memberDto() in a loop is an N+1.
export async function memberDto(row: MemberRow): Promise<MemberDto> {
	const reachable = await reachableMemberIds('telegram', [row.id])
	return base(row, reachable.has(row.id))
}

export async function memberDtos(rows: MemberRow[]): Promise<MemberDto[]> {
	const reachable = await reachableMemberIds(
		'telegram',
		rows.map((r) => r.id)
	)
	return rows.map((r) => base(r, reachable.has(r.id)))
}

async function reachableMemberIds(
	transport: NotificationTransport,
	memberIds: string[]
): Promise<Set<string>> {
	if (memberIds.length === 0) return new Set()
	const rows = await useDb()
		.select({ memberId: schema.memberNotificationLinks.memberId })
		.from(schema.memberNotificationLinks)
		.where(
			and(
				eq(schema.memberNotificationLinks.transport, transport),
				inArray(schema.memberNotificationLinks.memberId, memberIds),
				isNotNull(schema.memberNotificationLinks.externalId),
				eq(schema.memberNotificationLinks.notificationsEnabled, true)
			)
		)
	return new Set(rows.map((r) => r.memberId))
}

export function avatarObjectKey(memberId: string, avatarId: string) {
	return `avatars/${memberId}/${avatarId}`
}
