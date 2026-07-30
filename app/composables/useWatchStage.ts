// Where the Watch Together player is drawn.
//
// The player is mounted ONCE in the layout, outside <NuxtPage>, and never
// unmounted while a session is running — navigating to a text channel would
// otherwise destroy the iframe's browsing context and stop the video for that
// member. Only its position and size change: docked over the voice channel's
// stage, or a floating mini player anywhere else. Nothing is ever reparented.
//
// ChannelVoice registers an empty placeholder element; this tracks that
// element's box, and WatchPlayerHost renders the player on top of it.

export interface StageRect {
	top: number
	left: number
	width: number
	height: number
}

export const MINI_WIDTH = 320
export const MINI_HEIGHT = 180
export const MINI_MARGIN = 16

// Module-level singletons rather than useState: these hold a DOM element and
// viewport geometry, neither of which can be serialized into the SSR payload,
// and there is exactly one player for the whole app.
const slotEl = shallowRef<HTMLElement | null>(null)
const dockedRect = ref<StageRect | null>(null)
let rafId: number | null = null

function sameRect(a: StageRect | null, b: StageRect) {
	return !!a && a.top === b.top && a.left === b.left && a.width === b.width && a.height === b.height
}

/**
 * Follow the placeholder's box on every frame.
 *
 * A ResizeObserver is not enough: collapsing the sidebar MOVES the stage
 * without resizing it, and an observer never fires for that. Reading one
 * element's rect per frame is cheap, and the loop only runs while docked.
 */
function track() {
	const el = slotEl.value
	if (!el) {
		dockedRect.value = null
		rafId = null
		return
	}
	const r = el.getBoundingClientRect()
	const next = { top: r.top, left: r.left, width: r.width, height: r.height }
	if (!sameRect(dockedRect.value, next)) dockedRect.value = next
	rafId = requestAnimationFrame(track)
}

export function useWatchStage() {
	/** Called by ChannelVoice with its placeholder element, or null on unmount. */
	function setSlot(el: HTMLElement | null) {
		slotEl.value = el
		if (!import.meta.client) return
		if (el) {
			if (rafId === null) rafId = requestAnimationFrame(track)
		} else {
			if (rafId !== null) cancelAnimationFrame(rafId)
			rafId = null
			dockedRect.value = null
		}
	}

	/** Default mini position: bottom-right, clear of the viewport edges. */
	function defaultMiniPos() {
		return {
			x: Math.max(MINI_MARGIN, window.innerWidth - MINI_WIDTH - MINI_MARGIN),
			y: Math.max(MINI_MARGIN, window.innerHeight - MINI_HEIGHT - MINI_MARGIN)
		}
	}

	/** Keep a dragged position on screen after a resize or a rotate. */
	function clampMiniPos(pos: { x: number; y: number }) {
		return {
			x: Math.min(Math.max(0, pos.x), Math.max(0, window.innerWidth - MINI_WIDTH)),
			y: Math.min(Math.max(0, pos.y), Math.max(0, window.innerHeight - MINI_HEIGHT))
		}
	}

	return { dockedRect: readonly(dockedRect), setSlot, defaultMiniPos, clampMiniPos }
}
