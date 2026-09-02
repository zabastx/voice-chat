<template>
	<!-- graceful fallback if the audio can't be played -->
	<a
		v-if="failed && attachment"
		:href="`/api/attachments/${attachment.id}`"
		class="border-default bg-elevated/50 hover:bg-elevated flex items-center gap-2 rounded-lg border px-3 py-2"
		rel="noopener"
		target="_blank"
	>
		<UIcon class="text-primary size-5 shrink-0" name="i-lucide-mic" />
		<p class="text-default truncate text-sm">Голосовое сообщение</p>
	</a>
	<div
		v-else-if="failed"
		class="border-default bg-elevated/50 flex items-center gap-2 rounded-lg border px-3 py-2"
	>
		<UIcon class="text-error size-5 shrink-0" name="i-lucide-circle-alert" />
		<p class="text-muted text-sm">Не удалось воспроизвести запись</p>
	</div>

	<div
		v-else
		ref="root"
		class="border-default bg-elevated/50 flex w-72 max-w-full items-center gap-3 rounded-lg border px-3 py-2"
	>
		<!-- Playback runs through a plain media element: it streams, and it holds a
		     decoder rather than the whole clip as raw samples. -->
		<audio
			ref="audioEl"
			:src="src"
			preload="metadata"
			@canplay="ready = true"
			@durationchange="onDurationChange"
			@ended="onEnded"
			@error="failed = true"
			@loadedmetadata="onLoadedMetadata"
			@pause="playing = false"
			@play="playing = true"
			@timeupdate="onTimeUpdate"
		/>

		<UButton
			:disabled="loading"
			:icon="playing ? 'i-lucide-pause' : 'i-lucide-play'"
			:loading="loading"
			color="primary"
			size="sm"
			variant="soft"
			@click="() => togglePlay()"
		/>

		<div class="min-w-0 flex-1">
			<div
				ref="waveEl"
				class="flex h-8 cursor-pointer touch-none items-center gap-px"
				@pointercancel="onPointerUp"
				@pointerdown="onPointerDown"
				@pointermove="onPointerMove"
				@pointerup="onPointerUp"
			>
				<template v-if="peaks.length">
					<div
						v-for="(peak, index) in peaks"
						:key="index"
						:class="index < progress * peaks.length ? 'bg-primary' : 'bg-muted'"
						:style="{ height: `${Math.max(10, peak * 100)}%` }"
						class="flex-1 rounded-full transition-colors"
					/>
				</template>
				<div v-else class="bg-muted h-0.5 flex-1 rounded-full" />
			</div>
			<p class="text-muted mt-0.5 text-xs tabular-nums">
				{{ formatDuration(displayTime) }}
			</p>
		</div>
	</div>
</template>

<script lang="ts" setup>
// `blob` powers the pre-send preview; `attachment` plays a stored message
const props = defineProps<{ attachment?: AttachmentDto; blob?: Blob }>()

const BARS = 48

// Sample rate for the waveform decode. The bars are 48 peaks over the whole clip,
// so the decode only has to be fine-grained enough to find them — and decoding at
// 8 kHz instead of the file's own 48 kHz is 6× less memory while it happens. It
// matters because this used to be a full-rate decode kept alive for the lifetime
// of the component: a five-minute note is ~58 MB of Float32 that way, per note,
// for a waveform 300 px wide.
const WAVEFORM_RATE = 8000

// The button waits on `ready` (the element says it can play), NOT on knowing the
// duration. Those are two different questions, and conflating them is how a clip
// whose container hides its length ends up unplayable: see the probe below.
const ready = ref(false)
const durationKnown = ref(false)
const loading = computed(() => !ready.value && !durationKnown.value)
const failed = ref(false)
const peaks = ref<number[]>([])
const duration = ref(0)
const currentTime = ref(0)
const playing = ref(false)

const root = ref<HTMLElement>()
const waveEl = ref<HTMLElement>()
const audioEl = ref<HTMLAudioElement>()

// object URL for the pre-send preview; revoked on unmount
const blobUrl = ref<string>()
const src = computed(() =>
	props.blob ? blobUrl.value : props.attachment ? `/api/attachments/${props.attachment.id}` : ''
)

const progress = computed(() => (duration.value ? currentTime.value / duration.value : 0))
// total while idle, elapsed once playback has moved
const displayTime = computed(() => (currentTime.value > 0 ? currentTime.value : duration.value))

function computePeaks(audioBuffer: AudioBuffer) {
	const data = audioBuffer.getChannelData(0)
	const block = Math.floor(data.length / BARS) || 1
	const result: number[] = []
	let max = 0
	for (let i = 0; i < BARS; i++) {
		let peak = 0
		const start = i * block
		for (let j = 0; j < block; j++) {
			const v = Math.abs(data[start + j] ?? 0)
			if (v > peak) peak = v
		}
		result.push(peak)
		if (peak > max) max = peak
	}
	return max > 0 ? result.map((v) => v / max) : result
}

// --- waveform, on demand ----------------------------------------------------

let waveformStarted = false

/**
 * Fetch and decode the clip once, purely to draw the bars, then let the samples
 * go. Deliberately NOT called on mount: a channel can hold a screenful of voice
 * messages, and downloading and decoding every one of them for a picture nobody
 * has scrolled to yet was the single most expensive thing this component did.
 */
async function loadWaveform() {
	if (waveformStarted) return
	waveformStarted = true
	try {
		let bytes: ArrayBuffer
		if (props.blob) {
			bytes = await props.blob.arrayBuffer()
		} else if (props.attachment) {
			// `?proxy` streams bytes through the app; the default 302-to-S3 would be a
			// cross-origin read here and the bucket sends no CORS headers.
			const res = await fetch(`/api/attachments/${props.attachment.id}?proxy`)
			if (!res.ok) throw new Error('fetch failed')
			bytes = await res.arrayBuffer()
		} else {
			return
		}
		// decodeAudioData resamples to the context's rate, so this is where the 6×
		// saving comes from; the buffer is local and collectable the moment we're done
		const offline = new OfflineAudioContext(1, 1, WAVEFORM_RATE)
		const buffer = await offline.decodeAudioData(bytes)
		peaks.value = computePeaks(buffer)
		// a WebM/Opus recording carries no duration in its container, so the decoded
		// buffer is the most reliable source we have — see onLoadedMetadata
		if (!durationKnown.value) {
			duration.value = buffer.duration
			durationKnown.value = true
			// the probe, if one is still waiting, has just been answered from elsewhere
			endProbe()
		}
	} catch {
		// no bars, but playback is unaffected — a flat line is a better outcome
		// than the whole player falling back to a download link
	}
}

// --- media element ----------------------------------------------------------

// True while the duration probe below is seeking; position updates during it are
// meaningless (the element reports the seek target, not a playback position).
let probingDuration = false
let probeTimer: ReturnType<typeof setTimeout> | undefined

// How long to wait for the probe's `durationchange` before giving up on ever
// knowing the length. Nothing guarantees the event: a truncated recording, a
// range-less response, a browser that answers the seek with nothing. Waiting
// forever would be silent — the player would just sit there.
const PROBE_TIMEOUT_MS = 4000

function endProbe() {
	if (!probingDuration) return
	probingDuration = false
	clearTimeout(probeTimer)
	probeTimer = undefined
	const el = audioEl.value
	if (el && el.currentTime > 0 && !durationKnown.value) el.currentTime = 0
	currentTime.value = 0
}

function onLoadedMetadata() {
	const el = audioEl.value
	if (!el) return
	if (Number.isFinite(el.duration) && el.duration > 0) {
		duration.value = el.duration
		durationKnown.value = true
		return
	}
	// A MediaRecorder WebM carries no duration in its container until it has been
	// seeked to the end — this is why the old full decode was load-bearing here, and
	// the seek is the cheap way to get the same answer.
	probingDuration = true
	probeTimer = setTimeout(() => {
		// Give up on the length, not on the clip. The waveform decode may still fill
		// `duration` in later; until then the label reads 0:00 and the wave can't be
		// scrubbed, but the thing plays, which is what the button is for.
		endProbe()
	}, PROBE_TIMEOUT_MS)
	el.currentTime = 1e101
}

function onDurationChange() {
	const el = audioEl.value
	if (!el || !Number.isFinite(el.duration) || el.duration <= 0) return
	duration.value = el.duration
	durationKnown.value = true
	if (probingDuration) {
		probingDuration = false
		clearTimeout(probeTimer)
		probeTimer = undefined
		el.currentTime = 0
		currentTime.value = 0
	}
}

function onTimeUpdate() {
	if (probingDuration) return
	currentTime.value = audioEl.value?.currentTime ?? 0
}

function onEnded() {
	playing.value = false
	currentTime.value = 0
	if (audioEl.value) audioEl.value.currentTime = 0
}

async function togglePlay() {
	const el = audioEl.value
	if (!el) return
	if (playing.value) {
		el.pause()
		return
	}
	if (el.currentTime >= duration.value) el.currentTime = 0
	try {
		await el.play()
	} catch {
		failed.value = true
	}
}

function seekTo(t: number) {
	const el = audioEl.value
	if (!el || !duration.value) return
	const clamped = Math.min(Math.max(0, t), duration.value)
	el.currentTime = clamped
	currentTime.value = clamped
}

let dragging = false
function seekFromClientX(clientX: number) {
	const el = waveEl.value
	if (!el || !duration.value) return
	const rect = el.getBoundingClientRect()
	const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
	seekTo(ratio * duration.value)
}

function onPointerDown(e: PointerEvent) {
	dragging = true
	;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
	seekFromClientX(e.clientX)
}
function onPointerMove(e: PointerEvent) {
	if (dragging) seekFromClientX(e.clientX)
}
function onPointerUp() {
	dragging = false
}

// --- lifecycle --------------------------------------------------------------

let observer: IntersectionObserver | undefined

onMounted(() => {
	if (props.blob) blobUrl.value = URL.createObjectURL(props.blob)
	if (!root.value) return
	// a little ahead of the viewport, so the bars are already drawn by the time
	// the player is actually looked at
	observer = new IntersectionObserver(
		(entries) => {
			if (!entries.some((entry) => entry.isIntersecting)) return
			observer?.disconnect()
			observer = undefined
			void loadWaveform()
		},
		{ rootMargin: '300px' }
	)
	observer.observe(root.value)
})

onBeforeUnmount(() => {
	clearTimeout(probeTimer)
	observer?.disconnect()
	audioEl.value?.pause()
	if (blobUrl.value) URL.revokeObjectURL(blobUrl.value)
})
</script>
