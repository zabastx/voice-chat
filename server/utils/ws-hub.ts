import type { Peer } from 'crossws'

interface WsMember {
	memberId: string
	username: string
}

const TICKET_TTL_MS = 30_000

const tickets = new Map<string, WsMember & { expires: number }>()
const clients = new Map<string, WsMember & { peer: Peer }>()

export function createWsTicket(member: WsMember) {
	// tickets are only deleted on consumption — purge expired ones here or
	// never-used tickets pile up for the life of the process
	const now = Date.now()
	for (const [key, entry] of tickets) {
		if (entry.expires < now) tickets.delete(key)
	}
	const ticket = newToken()
	tickets.set(ticket, { ...member, expires: now + TICKET_TTL_MS })
	return ticket
}

export function consumeWsTicket(ticket: string | undefined): WsMember | null {
	if (!ticket) return null
	const entry = tickets.get(ticket)
	tickets.delete(ticket)
	if (!entry || entry.expires < Date.now()) return null
	return { memberId: entry.memberId, username: entry.username }
}

export function wsOnline(): string[] {
	return [...new Set([...clients.values()].map((c) => c.memberId))]
}

export function wsBroadcast(event: ServerEvent) {
	const payload = JSON.stringify(event)
	for (const client of clients.values()) {
		client.peer.send(payload)
	}
}

// Targeted delivery for private events (DMs): only sockets belonging to one of
// `memberIds` receive the payload. A member may have several open tabs, so this
// matches on memberId, not peer id.
export function wsSendToMembers(memberIds: string[], event: ServerEvent) {
	if (memberIds.length === 0) return
	const targets = new Set(memberIds)
	const payload = JSON.stringify(event)
	for (const client of clients.values()) {
		if (targets.has(client.memberId)) client.peer.send(payload)
	}
}

export function wsMemberFor(peer: Peer): WsMember | undefined {
	return clients.get(peer.id)
}

export function wsRegister(peer: Peer, member: WsMember) {
	clients.set(peer.id, { ...member, peer })
	wsBroadcast({ type: 'presence', online: wsOnline() })
}

export function wsUnregister(peer: Peer) {
	if (clients.delete(peer.id)) {
		wsBroadcast({ type: 'presence', online: wsOnline() })
	}
}
