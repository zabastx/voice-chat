<template>
	<div class="relative flex min-h-0 flex-1 items-center justify-center bg-black">
		<!--
			The YouTube API REPLACES the element it's handed with an <iframe>. That
			node is therefore created imperatively and never owned by Vue: if Vue
			held it, unmount would call removeChild on a node whose parentNode the
			API already cleared. Vue owns this stable host; the API owns its child.

			This component must also stay mounted across focus/layout changes —
			moving an iframe discards its browsing context and restarts the video
			from zero (adr/0008).
		-->
		<!--
			The size rules are on the host, not applied to the frame after load: the
			API's generated iframe carries width=640 height=390 attributes, so
			waiting until onReady to size it produces a visible flash.
		-->
		<div ref="hostEl" class="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" />

		<!-- embedding refused by the uploader, or the video is gone -->
		<div
			v-if="error"
			class="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center"
		>
			<UIcon class="size-10 text-white/40" name="i-lucide-tv-minimal-play" />
			<p class="text-sm text-white/80">{{ error }}</p>
			<UButton
				color="neutral"
				icon="i-lucide-x"
				label="Остановить просмотр"
				size="sm"
				variant="soft"
				@click="watchSession.stop"
			/>
		</div>

		<!--
			Autoplay refused. The click both satisfies the browser's user-activation
			requirement and re-applies the anchor, so the viewer lands in sync
			rather than at the position from when the page loaded.
		-->
		<button
			v-else-if="needsGesture"
			class="absolute inset-0 flex cursor-pointer flex-col items-center justify-center gap-3 bg-black/70"
			type="button"
			@click="resumeFromGesture"
		>
			<UIcon class="size-12 text-white" name="i-lucide-play" />
			<span class="text-sm text-white/80">Нажмите, чтобы смотреть</span>
		</button>
	</div>
</template>

<script lang="ts" setup>
const props = defineProps<{ session: WatchDto }>()

const watchSession = useWatch()
const prefs = usePreferences()

const hostEl = useTemplateRef<HTMLElement>('hostEl')
const error = ref<string | null>(null)
const needsGesture = ref(false)

let player: YT.Player | null = null
// `new YT.Player()` returns synchronously, but the returned object has none of
// its API methods until onReady fires. Anything that touches the player before
// then throws — and since broadcasts can arrive during init, that throw lands
// inside a Vue watcher and repeats, leaving the stage mounted with no iframe.
let ready = false
let driftTimer: ReturnType<typeof setInterval> | null = null
let gestureTimer: ReturnType<typeof setTimeout> | null = null

// Live-ness starts UNKNOWN, not false. The session DTO says `live: false` until
// some client's player reports otherwise, and acting on that guess is
// destructive: seeking a live stream to the anchor throws the viewer to the
// start of the DVR window, and drift correction is disabled the moment the
// flag lands — so they stay there. Position is left alone until we know.
let liveKnown = false

// Last observed playhead, for telling a user's seek apart from drift. Real
// playback advances by roughly the elapsed wall time; a seek doesn't.
let lastPos = 0
let lastPosAt = 0

function notePosition(position: number) {
	lastPos = position
	lastPosAt = performance.now()
}

// --- echo guard ---------------------------------------------------------
// Steering the player fires the same events a human click does. Without this,
// a remote seek would bounce straight back to the server and thrash the
// anchor. The window is generous because the API reports state changes well
// after the call that caused them.
let applyingRemote = false
let releaseTimer: ReturnType<typeof setTimeout> | null = null

function applyRemote(fn: () => void) {
	applyingRemote = true
	if (releaseTimer) clearTimeout(releaseTimer)
	try {
		fn()
	} finally {
		releaseTimer = setTimeout(() => {
			applyingRemote = false
			releaseTimer = null
		}, 900)
	}
}

// --- IFrame API loader --------------------------------------------------
// One script for the whole page, shared by every mount.
let apiPromise: Promise<void> | null = null

function loadApi(): Promise<void> {
	if (window.YT?.Player) return Promise.resolve()
	apiPromise ??= new Promise<void>((resolve, reject) => {
		const previous = window.onYouTubeIframeAPIReady
		window.onYouTubeIframeAPIReady = () => {
			previous?.()
			resolve()
		}
		const script = document.createElement('script')
		script.src = 'https://www.youtube.com/iframe_api'
		script.async = true
		script.onerror = () => reject(new Error('iframe_api'))
		document.head.appendChild(script)
	})
	return apiPromise
}

// --- player lifecycle ---------------------------------------------------

async function createPlayer() {
	if (!hostEl.value) return
	try {
		await loadApi()
	} catch {
		error.value = 'Не удалось загрузить проигрыватель YouTube'
		return
	}
	if (!window.YT?.Player || !hostEl.value) return

	const mount = document.createElement('div')
	mount.className = 'h-full w-full'
	hostEl.value.appendChild(mount)

	player = new window.YT.Player(mount, {
		videoId: props.session.ref,
		playerVars: {
			// don't autostart into a session that is already paused — it produces
			// an audible blip before onReady gets a chance to pause it
			autoplay: props.session.paused ? 0 : 1,
			// without this iOS Safari yanks the video into forced fullscreen,
			// which would destroy the stage/filmstrip layout entirely
			playsinline: 1,
			rel: 0,
			modestbranding: 1,
			enablejsapi: 1,
			start: Math.floor(watchSession.expectedPosition()),
			origin: window.location.origin
		},
		events: {
			onReady: onPlayerReady,
			onStateChange: onPlayerStateChange,
			onError: onPlayerError
		}
	})
}

function onPlayerReady() {
	if (!player) return
	ready = true
	// NOTE: the `allow` attribute is deliberately NOT set here. Permissions
	// policy is evaluated when the frame navigates, so writing it at onReady
	// cannot grant autoplay — and it would narrow the list the IFrame API
	// already put on its own frame (which includes autoplay).
	player.setVolume(prefs.value.watchVolume)
	notePosition(player.getCurrentTime())
	reportMetadata()
	applyAnchor()
	driftTimer = setInterval(correctDrift, 3000)
}

/**
 * Tell the server what only a loaded player knows: live-ness and title.
 *
 * Reports POSITIVES ONLY. `getVideoData()` is usually empty at onReady, so a
 * missing `isLive` means "don't know yet", which is indistinguishable from
 * "it's a VOD" — sending that as fact would flip a live session back to VOD
 * every time somebody joined. The server latches these on for the same reason.
 */
function reportMetadata() {
	const data = player?.getVideoData()
	if (!data) return
	if (data.isLive === true) liveKnown = true
	const meta: { live?: true; title?: string } = {}
	if (data.isLive === true) meta.live = true
	if (data.title) meta.title = data.title
	if (Object.keys(meta).length === 0) return
	void watchSession.reportMeta(props.session.ref, meta)
}

function onPlayerError(event: YT.ErrorEvent) {
	error.value =
		event.data === 101 || event.data === 150
			? 'Владелец видео запретил встраивание — его можно смотреть только на YouTube. Попробуйте демонстрацию экрана.'
			: event.data === 100
				? 'Видео не найдено или удалено.'
				: 'Не удалось воспроизвести видео.'
}

function onPlayerStateChange(event: YT.StateChangeEvent) {
	const state = event.data
	// the title/live flag is usually not populated until playback actually starts
	if (state === 1) {
		needsGesture.value = false
		reportMetadata()
		// nothing more is knowable about live-ness once playback is under way
		liveKnown = true
	}

	// The video ran out. Left unhandled the server anchor advances past the
	// duration forever, and the next playVideo() replays from zero — which the
	// old code then pushed to the whole room as a seek to 0.
	if (state === 0) {
		if (!applyingRemote && !props.session.paused && !props.session.live) {
			void watchSession.pushState(true, player?.getDuration() ?? 0)
		}
		return
	}

	if (state !== 1 && state !== 2) return
	if (applyingRemote || !player) return

	// Only a change in the paused flag is unambiguous user intent here.
	// Position differences are handled in correctDrift, which can tell a seek
	// from drift; pushing them from this handler is what let one viewer's ad
	// break rewind everyone else.
	const paused = state === 2
	if (paused === props.session.paused) {
		// Deliberately does NOT refresh the position baseline. A seek fires a
		// state change, and updating the baseline here would erase the very jump
		// correctDrift needs to see — the seek would then look like ordinary
		// playback and get "corrected" back to the anchor instead of broadcast.
		return
	}
	const position = props.session.live ? 0 : player.getCurrentTime()
	notePosition(player.getCurrentTime())
	void watchSession.pushState(paused, position)
}

// --- applying remote state ---------------------------------------------

/**
 * Bring the player in line with the anchor.
 *
 * Every action is conditional, because this runs on EVERY watch broadcast —
 * including ones about other voice channels, since the server re-resolves and
 * re-sends the whole map each time. Calling playVideo() and arming the echo
 * window unconditionally meant a stranger pausing a video in another room
 * could swallow this viewer's next click.
 */
function applyAnchor() {
	if (!player || !ready) return
	const session = props.session
	const state = player.getPlayerState()
	// position enforcement waits until live-ness is settled; seeking a live
	// stream to the anchor strands the viewer at the start of the DVR window
	const canSeek = !session.live && liveKnown && state !== 0
	const expected = watchSession.expectedPosition()
	const needsSeek = canSeek && Math.abs(player.getCurrentTime() - expected) > DRIFT_TOLERANCE_SEC
	const needsPause = session.paused && state === 1
	const needsPlay = !session.paused && (state === 2 || state === 5 || state === -1)
	if (!needsSeek && !needsPause && !needsPlay) return

	applyRemote(() => {
		if (!player) return
		if (needsSeek) {
			player.seekTo(expected, true)
			notePosition(expected)
		}
		if (needsPause) player.pauseVideo()
		if (needsPlay) {
			player.playVideo()
			scheduleGestureCheck()
		}
	})
}

/**
 * playVideo() reports no failure, so autoplay refusal is detected by looking
 * at where the player actually got to a moment later.
 */
function scheduleGestureCheck() {
	if (gestureTimer) clearTimeout(gestureTimer)
	gestureTimer = setTimeout(() => {
		gestureTimer = null
		if (!player || !ready || props.session.paused) return
		// Refusal looks like a player that never started: UNSTARTED or CUED.
		// PAUSED means it started and something paused it — usually the viewer
		// themselves — and treating that as refusal put an unclickable overlay
		// over the video, which also froze drift correction until it was clicked.
		const state = player.getPlayerState()
		needsGesture.value = state === -1 || state === 5
	}, 1500)
}

function resumeFromGesture() {
	needsGesture.value = false
	applyAnchor()
}

function correctDrift() {
	if (!player || !ready || error.value || needsGesture.value) return
	const session = props.session
	const state = player.getPlayerState()

	// Every early return refreshes the baseline. A stale one would make the next
	// tick see a playhead that "didn't move" across a long gap, which the jump
	// test below would have to interpret.
	if (session.paused) {
		if (state === 1) applyRemote(() => player?.pauseVideo())
		notePosition(player.getCurrentTime())
		return
	}
	// paused / cued / unstarted while the room is playing — get moving
	if (state === 2 || state === 5 || state === -1) {
		applyRemote(() => {
			player?.playVideo()
			scheduleGestureCheck()
		})
		notePosition(player.getCurrentTime())
		return
	}
	// buffering: let it recover on its own. Nobody waits for the slowest viewer,
	// and a seek mid-buffer only makes it worse (adr/0008).
	if (state !== 1) {
		notePosition(player.getCurrentTime())
		return
	}
	// a live broadcast rides the live edge; there is no position to correct to
	if (session.live || !liveKnown) return

	const position = player.getCurrentTime()
	const advance = position - lastPos
	const elapsed = (performance.now() - lastPosAt) / 1000
	notePosition(position)
	if (applyingRemote) return

	// Did the viewer scrub, or did we just fall behind? With native controls both
	// present identically as "my playhead disagrees with the anchor", so the only
	// discriminator is HOW the playhead moved relative to wall time.
	//
	// The test must be ASYMMETRIC. Comparing |advance - elapsed| looks right and
	// is badly wrong: a buffering stall or an ad advances the playhead by ~0 over
	// a 3s tick, which that test reads as a seek — and broadcasting it rewinds
	// everyone else, exactly the failure this whole mechanism exists to prevent.
	//   advance ≈ elapsed  → normal playback
	//   advance ≫ elapsed  → jumped ahead  → SEEK
	//   advance < 0        → jumped back   → SEEK
	//   0 ≤ advance ≪ elapsed → stalled/ad → DRIFT: correct locally, say nothing
	const jumpedAhead = advance > elapsed + DRIFT_TOLERANCE_SEC
	const jumpedBack = advance < -DRIFT_TOLERANCE_SEC
	if (jumpedAhead || jumpedBack) {
		void watchSession.pushState(false, position)
		return
	}

	const expected = watchSession.expectedPosition()
	if (Math.abs(position - expected) > DRIFT_TOLERANCE_SEC) {
		applyRemote(() => {
			player?.seekTo(expected, true)
			notePosition(expected)
		})
	}
}

// --- reacting to the session ---------------------------------------------

watch(
	() => props.session.ref,
	(ref) => {
		if (!player || !ready) return
		// loadVideoById swaps the source INSIDE the existing frame; recreating the
		// player would tear down the iframe and take the browsing context with it
		error.value = null
		needsGesture.value = false
		// per-video facts, all invalid for the new source
		liveKnown = false
		notePosition(0)
		applyRemote(() => player?.loadVideoById({ videoId: ref, startSeconds: 0 }))
		void nextTick(() => scheduleGestureCheck())
	}
)

// any other change (play/pause/seek by someone else) applies immediately
// rather than waiting up to 3s for the drift tick
watch(
	() => [props.session.paused, props.session.positionSec, props.session.live],
	() => applyAnchor()
)

watch(
	() => prefs.value.watchVolume,
	(volume) => {
		if (ready) player?.setVolume(volume)
	}
)

onMounted(() => {
	void createPlayer()
})

onUnmounted(() => {
	if (driftTimer) clearInterval(driftTimer)
	if (releaseTimer) clearTimeout(releaseTimer)
	if (gestureTimer) clearTimeout(gestureTimer)
	ready = false
	player?.destroy()
	player = null
})
</script>
