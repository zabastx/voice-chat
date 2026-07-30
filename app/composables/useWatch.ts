// Watch Together client state (adr/0008, adr/0009).
//
// This composable owns the *anchor and the commands*; the player itself lives
// in WatchStage.vue. The seam matters: everything here is provider-agnostic
// arithmetic and HTTP, and nothing here knows what a YouTube IFrame is.

// How far a client may drift from the Playback Anchor before it hard-seeks.
// Generous on purpose — the point is to catch an ad break or a buffering
// stall, not to chase frame accuracy nobody can perceive.
export const DRIFT_TOLERANCE_SEC = 2

// How long an attribution notice stays on the player before fading.
export const NOTICE_MS = 2500

/**
 * A transient "who just did that" caption, drawn inside the player rather than
 * as an app-wide toast.
 *
 * Toasts were wrong for this: during a seek war they stack up over whatever
 * the member is actually reading, and they are least welcome exactly when
 * they fire most. The player is on screen the whole time anyone is in the
 * Audience — docked in the call view, or as the mini player everywhere else —
 * so an in-player caption reaches the same people while staying attached to
 * the thing it describes.
 */
export interface WatchNotice {
	// bumped per notice so a repeat of the same text still re-triggers the
	// enter transition instead of sitting there unchanged
	id: number
	text: string
	icon: string
}

/**
 * The Playback Anchor as this device sees it. `at` is a `performance.now()`
 * reading taken when the DTO ARRIVED, never a server timestamp — the server
 * resolves the position at send time precisely so no clock comparison is ever
 * needed. A device with an 8-second-wrong clock would otherwise compute a
 * position 8 seconds off, seek to it, and re-seek forever (adr/0008).
 */
interface LocalAnchor {
	// which channel this anchor belongs to, so a channel switch is never mistaken
	// for someone changing the video
	channelId: string
	ref: string
	positionSec: number
	at: number
	paused: boolean
	live: boolean
}

// exactly one anchoring watcher regardless of how many components call this
let anchorStarted = false
// which channel the last anchor belonged to, kept outside the anchor itself so
// that "no session is playing" and "we are in a different room" stay
// distinguishable — the anchor is null in both cases
let lastChannelId: string | null = null
let noticeTimer: ReturnType<typeof setTimeout> | null = null
let noticeSeq = 0

export function useWatch() {
	const realtime = useRealtime()
	const voice = useVoice()
	const membersStore = useMembersStore()
	const toast = useToast()
	const { user } = useUserSession()

	const anchor = useState<LocalAnchor | null>('watch-anchor', () => null)
	const notice = useState<WatchNotice | null>('watch-notice', () => null)

	function showNotice(text: string, icon: string) {
		noticeSeq += 1
		notice.value = { id: noticeSeq, text, icon }
		if (noticeTimer) clearTimeout(noticeTimer)
		noticeTimer = setTimeout(() => {
			notice.value = null
			noticeTimer = null
		}, NOTICE_MS)
	}

	// The Watch Session for the channel we are connected to. Watching requires
	// being in the room — the Audience is the roster (adr/0009).
	const session = computed<WatchDto | null>(() => {
		const channelId = voice.currentChannelId.value
		if (!channelId) return null
		return realtime.watch.value[channelId] ?? null
	})

	// Any session in any channel, for the sidebar — visible without joining.
	function sessionFor(channelId: string): WatchDto | undefined {
		return realtime.watch.value[channelId]
	}

	if (import.meta.client && !anchorStarted) {
		anchorStarted = true
		const actorName = (id: string) =>
			membersStore.profile(id)?.displayName ?? membersStore.profile(id)?.username ?? 'Кто-то'

		// Detached scope: this must outlive whichever component mounted first.
		//
		// It therefore watches the GLOBAL useState refs, never the `session`
		// computed above — that computed belongs to the scope of whichever
		// component happened to call useWatch() first, and when that component
		// unmounts its effect stops and this watcher goes deaf permanently. The
		// symptom is specific and easy to miss: leaving a voice channel and
		// rejoining without a page reload leaves the anchor null and no player
		// mounted, while a fresh page load works perfectly.
		effectScope(true).run(() => {
			watch(
				[realtime.watch, voice.currentChannelId, realtime.watchAt],
				(current, previous) => {
					const channelId = current[1]
					const next = channelId ? (current[0][channelId] ?? null) : null
					// previous is undefined on the immediate run — never destructure it
					const prevChannelId = previous?.[1]
					const prev = prevChannelId ? (previous?.[0]?.[prevChannelId] ?? null) : null
					// A channel switch replaces the session wholesale; nothing happened
					// to the one we were watching, so nothing may be attributed to
					// anyone. Distinct from the session genuinely ending.
					const sameRoom = lastChannelId !== null && lastChannelId === channelId

					if (!next) {
						anchor.value = null
						// a pending caption belongs to a player that no longer exists
						if (noticeTimer) clearTimeout(noticeTimer)
						noticeTimer = null
						notice.value = null
						// Was this the session ending, or did we just leave the room?
						// Both null the session; only the first is worth announcing.
						//
						// The one message that stays a toast: the player is gone by the
						// time it fires, so there is nothing to draw it on — and in mini
						// mode the video otherwise just vanishes from the corner with no
						// explanation. Fires once per session, not per control action.
						if (prev && channelId && sameRoom) {
							toast.add({ title: 'Совместный просмотр остановлен', icon: 'i-lucide-tv' })
						}
						lastChannelId = channelId
						return
					}
					if (!channelId) {
						lastChannelId = null
						return
					}

					// What we believed playback was at, computed the instant before we
					// re-anchor. Comparing the incoming position against THIS (rather
					// than against the previous DTO's position, which was resolved at a
					// different wall-clock moment) is what separates a real seek from
					// ordinary elapsed time.
					const predicted = anchor.value && sameRoom ? expectedPosition() : null

					// Re-anchor on the arrival time of the map this DTO came from — NOT
					// on now. The two differ whenever the session became visible to us
					// for a reason other than a fresh broadcast, e.g. joining the room.
					anchor.value = {
						channelId,
						ref: next.ref,
						positionSec: next.positionSec,
						at: realtime.watchAt.value,
						paused: next.paused,
						live: next.live
					}
					const wasSameRoom = sameRoom
					lastChannelId = channelId

					// attribute the change, unless we caused it or just walked in on it
					if (!wasSameRoom || next.actorId === user.value?.id) return
					const who = actorName(next.actorId)
					// Russian verbs agree with the actor's gender; a noun phrase doesn't,
					// so these read correctly whoever performed the action.
					if (!prev || prev.ref !== next.ref) {
						showNotice(`Включено видео · ${who}`, 'i-lucide-tv')
					} else if (prev.paused !== next.paused) {
						showNotice(
							next.paused ? `Пауза · ${who}` : `Продолжаем · ${who}`,
							next.paused ? 'i-lucide-pause' : 'i-lucide-play'
						)
					} else if (
						!next.live &&
						predicted !== null &&
						Math.abs(predicted - next.positionSec) > DRIFT_TOLERANCE_SEC
					) {
						showNotice(`Перемотка · ${who}`, 'i-lucide-fast-forward')
					}
				},
				{ immediate: true }
			)
		})
	}

	/** Where playback should be right now, counted forward on our own clock. */
	function expectedPosition(): number {
		const a = anchor.value
		if (!a) return 0
		// a paused session is frozen; a live one has no shared timeline at all
		if (a.paused || a.live) return a.positionSec
		return a.positionSec + (performance.now() - a.at) / 1000
	}

	function channelId(): string | null {
		return voice.currentChannelId.value
	}

	async function start(url: string) {
		const id = channelId()
		if (!id) return
		await $fetch(`/api/channels/${id}/watch`, { method: 'POST', body: { url } })
	}

	async function stop() {
		const id = channelId()
		if (!id) return
		try {
			await $fetch(`/api/channels/${id}/watch`, { method: 'DELETE' })
		} catch {
			toast.add({ title: 'Не удалось остановить просмотр', color: 'error' })
		}
	}

	/** Push a local play/pause/seek to everyone else. */
	async function pushState(paused: boolean, positionSec: number) {
		const id = channelId()
		if (!id) return
		try {
			await $fetch(`/api/channels/${id}/watch/state`, {
				method: 'POST',
				body: { paused, positionSec: Math.max(0, positionSec) }
			})
		} catch {
			// the session was stopped or replaced under us; the next broadcast
			// corrects this client, so there is nothing useful to say here
		}
	}

	/** Report what only a loaded player can know: live-ness and title. */
	async function reportMeta(ref: string, meta: { live?: boolean; title?: string | null }) {
		const id = channelId()
		if (!id) return
		try {
			await $fetch(`/api/channels/${id}/watch/meta`, { method: 'POST', body: { ref, ...meta } })
		} catch {
			// cosmetic only — a missing title or a late live flag is not worth a toast
		}
	}

	return {
		session,
		sessionFor,
		anchor,
		notice,
		expectedPosition,
		start,
		stop,
		pushState,
		reportMeta
	}
}
