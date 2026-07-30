// In-memory Watch Sessions: what each Voice Channel is watching together.
// Shared playback intent, never media (adr/0008); ephemeral room state that
// shares the lifetime of the session it belongs to (adr/0009).
//
// Written by the /api/channels/:id/watch* endpoints and by the LiveKit
// room_finished webhook; read by everyone through the WS snapshot +
// watch.state broadcasts, exactly like Voice State next door.

interface WatchSession {
	source: 'youtube'
	ref: string
	paused: boolean
	live: boolean
	title: string | null
	actorId: string
	// PLAYBACK ANCHOR, server-side half: the position that was true at
	// `anchoredAt`, on the SERVER's clock. Both fields stay internal — the DTO
	// carries a position resolved at send time instead, so no client ever
	// compares its own clock against a server timestamp (adr/0008).
	positionSec: number
	anchoredAt: number
	// slope of the anchor: how many seconds of video pass per second of wall
	// clock. Every position calculation below multiplies by it.
	rate: number
}

const sessions = new Map<string, WatchSession>()

// Resolve the anchor forward to *now*. A paused session is frozen, so its
// stored position is already current; a live one has no meaningful timeline.
function resolvedPosition(session: WatchSession): number {
	if (session.paused || session.live) return session.positionSec
	return session.positionSec + ((Date.now() - session.anchoredAt) / 1000) * session.rate
}

function toDto(session: WatchSession): WatchDto {
	return {
		source: session.source,
		ref: session.ref,
		paused: session.paused,
		live: session.live,
		title: session.title,
		actorId: session.actorId,
		rate: session.rate,
		// rounded to ms; sub-millisecond precision is noise against a 2s threshold
		positionSec: Math.max(0, Math.round(resolvedPosition(session) * 1000) / 1000)
	}
}

export function watchRooms(): WatchRooms {
	const out: WatchRooms = {}
	for (const [channelId, session] of sessions) out[channelId] = toDto(session)
	return out
}

export function watchSessionFor(channelId: string): WatchDto | undefined {
	const session = sessions.get(channelId)
	return session ? toDto(session) : undefined
}

function broadcastWatch() {
	wsBroadcast({ type: 'watch.state', watch: watchRooms() })
}

/** Start a Watch Session, replacing whatever was playing. */
export function watchStart(
	channelId: string,
	actorId: string,
	source: { source: 'youtube'; ref: string; startSec: number }
) {
	sessions.set(channelId, {
		source: source.source,
		ref: source.ref,
		paused: false,
		// assume VOD; the first client whose player reports otherwise corrects it
		live: false,
		title: null,
		actorId,
		positionSec: source.startSec,
		anchoredAt: Date.now(),
		// a fresh video always starts at normal speed
		rate: 1
	})
	broadcastWatch()
}

export function watchStop(channelId: string) {
	if (sessions.delete(channelId)) broadcastWatch()
}

/** Play / pause / seek / speed. Re-anchors against the server clock. */
export function watchSetState(
	channelId: string,
	actorId: string,
	next: { paused: boolean; positionSec: number; rate?: number }
) {
	const session = sessions.get(channelId)
	if (!session) return false

	// Drop pushes that change nothing.
	//
	// A client steering its player in response to a broadcast can re-emit the
	// very event that caused it, once the local echo guard's window has expired
	// — YouTube's onPlaybackRateChange in particular can lag. That echo carries
	// no new state but does carry a new actor, and the resulting redundant
	// broadcast *steals the attribution*: clients batch it with the original and
	// see only the last one, whose actor is themselves, so everyone suppresses
	// the caption as their own action and nobody is told who did it.
	//
	// Ignoring no-ops kills the whole class server-side, where it can't be
	// defeated by one client's timing. A real seek moves the playhead far
	// further than this tolerance; anything inside it was not worth telling the
	// room about anyway.
	const nextRate = next.rate ?? session.rate
	const NOOP_POSITION_SEC = 1
	if (
		session.paused === next.paused &&
		Math.abs(nextRate - session.rate) < 0.01 &&
		Math.abs(resolvedPosition(session) - next.positionSec) < NOOP_POSITION_SEC
	) {
		return true
	}

	session.paused = next.paused
	session.positionSec = Math.max(0, next.positionSec)
	// Re-anchoring is what makes a rate change safe: the slope changes only from
	// this instant, so the seconds already elapsed keep their old rate instead
	// of being retroactively recomputed at the new one.
	session.anchoredAt = Date.now()
	if (next.rate !== undefined) session.rate = next.rate
	session.actorId = actorId
	broadcastWatch()
	return true
}

/**
 * Client-observed facts the server can't know: whether the source is a live
 * broadcast, and its title. Reported once by whichever client's player loads
 * first. Not a control action — it carries no actor and never re-anchors, so
 * it can't be mistaken for a seek.
 */
export function watchReportMetadata(
	channelId: string,
	ref: string,
	meta: { live?: boolean; title?: string | null }
) {
	const session = sessions.get(channelId)
	// ignore a late report for a video that has since been replaced
	if (!session || session.ref !== ref) return
	let changed = false
	// Only ever latch live ON. A player that hasn't loaded its metadata yet
	// reports "not live" indistinguishably from one that knows the video is a
	// VOD, so a negative is never trustworthy — and honouring one would flip a
	// live session back to VOD every time somebody new joined, unfreezing an
	// anchor that has been standing still and scattering the whole room.
	// Within a single `ref`, live never legitimately becomes false.
	if (meta.live === true && !session.live) {
		session.live = true
		changed = true
	}
	// same reasoning for the title: absence is not emptiness
	const title = meta.title?.trim()
	if (title && title !== session.title) {
		session.title = title
		changed = true
	}
	if (changed) broadcastWatch()
}

/**
 * The room emptied: pause the Watch Session but keep it (adr/0009). Pausing is
 * also required for correctness — an unpaused anchor with nobody watching would
 * silently run the film to its end while everyone is away.
 */
export function watchRoomFinished(channelId: string) {
	const session = sessions.get(channelId)
	if (!session || session.paused) return
	session.positionSec = resolvedPosition(session)
	session.anchoredAt = Date.now()
	session.paused = true
	broadcastWatch()
}

/** A deleted channel takes its Watch Session with it. */
export function watchChannelDeleted(channelId: string) {
	// broadcast like every other mutation — otherwise clients keep the dead
	// channel's entry in their map until some unrelated watch event clears it
	if (sessions.delete(channelId)) broadcastWatch()
}
