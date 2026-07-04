import type { Role } from './dto'

declare module '#auth-utils' {
	interface User {
		id: string
		username: string
		role: Role
	}
}

export {}
