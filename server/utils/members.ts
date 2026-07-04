interface MemberRow {
	id: string
	username: string
	displayName: string | null
	avatarId: string | null
	role: Role
	createdAt: Date
}

export function memberDto(row: MemberRow): MemberDto {
	return {
		id: row.id,
		username: row.username,
		displayName: row.displayName,
		avatarUrl: row.avatarId ? `/api/members/${row.id}/avatar?v=${row.avatarId}` : null,
		role: row.role,
		createdAt: row.createdAt.toISOString()
	}
}

export function avatarObjectKey(memberId: string, avatarId: string) {
	return `avatars/${memberId}/${avatarId}`
}
