interface MemberRow {
	id: string
	username: string
	displayName: string | null
	avatarId: string | null
	role: Role
	createdAt: Date
	telegramChatId: string | null
	telegramNotificationsEnabled: boolean
}

export function memberDto(row: MemberRow): MemberDto {
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		avatarUrl: row.avatarId ? `/api/members/${row.id}/avatar?v=${row.avatarId}` : null,
		role: row.role,
		createdAt: row.createdAt.toISOString(),
		telegramNotifications: !!row.telegramChatId && row.telegramNotificationsEnabled
	}
}

export function avatarObjectKey(memberId: string, avatarId: string) {
	return `avatars/${memberId}/${avatarId}`
}
