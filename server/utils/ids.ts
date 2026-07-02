import { randomBytes } from 'node:crypto'

export function newId() {
	return crypto.randomUUID()
}

export function newToken() {
	return randomBytes(18).toString('base64url')
}
