<template>
	<!--
		The single, persistent home of the Watch Together player. Lives in the
		layout, OUTSIDE <NuxtPage>, so route changes never unmount it — an iframe
		that is unmounted or reparented loses its browsing context and the video
		restarts from zero (adr/0008). Only `style` changes between docked and
		mini; the element itself never moves in the DOM.

		`flex` on the wrapper is load-bearing: WatchStage's root sizes itself with
		flex-1, so without a flex parent it leaves the bottom of the box unfilled.
	-->
	<ClientOnly>
		<div
			v-if="session"
			class="fixed z-40 flex overflow-hidden"
			:class="docked ? '' : 'ring-default rounded-lg shadow-2xl ring-1'"
			:style="style"
		>
			<WatchStage :session="session" />

			<!--
				Mini mode only: a transparent layer over the iframe that turns the
				player into a drag handle and a link back to the channel. It also
				deliberately swallows clicks on YouTube's own controls — a 320px
				player is far too small to aim at them, and the room's controls
				live in the call view we're sending them back to.
			-->
			<div
				v-if="!docked"
				class="absolute inset-0 cursor-grab active:cursor-grabbing"
				@pointerdown="onPointerDown"
			>
				<div
					class="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-1 bg-gradient-to-b from-black/70 to-transparent px-2 py-1.5"
				>
					<UIcon class="size-3.5 shrink-0 text-white/90" name="i-lucide-tv" />
					<span class="truncate text-xs text-white/90">{{ label }}</span>
				</div>
			</div>
		</div>
	</ClientOnly>
</template>

<script lang="ts" setup>
const watchSession = useWatch()
const voice = useVoice()
const prefs = usePreferences()
const stage = useWatchStage()

const session = computed(() => watchSession.session.value)
// docked whenever the voice channel's call view has registered its placeholder
const docked = computed(() => !!stage.dockedRect.value)

const label = computed(() => session.value?.title ?? 'Смотрим вместе')

const miniPos = ref<{ x: number; y: number }>({ x: 0, y: 0 })
let miniReady = false

function loadMiniPos() {
	miniPos.value = stage.clampMiniPos(prefs.value.watchMiniPos ?? stage.defaultMiniPos())
	miniReady = true
}

const style = computed(() => {
	const rect = stage.dockedRect.value
	if (rect) {
		return {
			top: `${rect.top}px`,
			left: `${rect.left}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`
		}
	}
	return {
		top: `${miniPos.value.y}px`,
		left: `${miniPos.value.x}px`,
		width: `${MINI_WIDTH}px`,
		height: `${MINI_HEIGHT}px`
	}
})

// --- drag, with click-to-return ------------------------------------------
// A press that barely moves is a click (go back to the channel); anything
// further is a drag. Without the threshold every drag would also navigate.
const CLICK_SLOP_PX = 5
let dragging = false
let moved = 0
let startX = 0
let startY = 0
let originX = 0
let originY = 0

function onPointerDown(event: PointerEvent) {
	if (event.button !== 0) return
	dragging = true
	moved = 0
	startX = event.clientX
	startY = event.clientY
	originX = miniPos.value.x
	originY = miniPos.value.y
	;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
	event.preventDefault()
}

function onPointerMove(event: PointerEvent) {
	if (!dragging) return
	const dx = event.clientX - startX
	const dy = event.clientY - startY
	moved = Math.max(moved, Math.abs(dx) + Math.abs(dy))
	miniPos.value = stage.clampMiniPos({ x: originX + dx, y: originY + dy })
}

function onPointerUp() {
	if (!dragging) return
	dragging = false
	if (moved <= CLICK_SLOP_PX) {
		const channelId = voice.currentChannelId.value
		if (channelId) void navigateTo(`/channels/${channelId}`)
		return
	}
	// only a real drag is worth remembering
	prefs.value.watchMiniPos = { ...miniPos.value }
}

function onResize() {
	if (miniReady) miniPos.value = stage.clampMiniPos(miniPos.value)
}

onMounted(() => {
	loadMiniPos()
	window.addEventListener('pointermove', onPointerMove)
	window.addEventListener('pointerup', onPointerUp)
	window.addEventListener('pointercancel', onPointerUp)
	window.addEventListener('resize', onResize)
})

onUnmounted(() => {
	window.removeEventListener('pointermove', onPointerMove)
	window.removeEventListener('pointerup', onPointerUp)
	window.removeEventListener('pointercancel', onPointerUp)
	window.removeEventListener('resize', onResize)
})
</script>
