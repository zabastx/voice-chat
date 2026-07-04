<template>
	<!-- graceful fallback if the audio can't be decoded -->
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
		class="border-default bg-elevated/50 flex w-72 max-w-full items-center gap-3 rounded-lg border px-3 py-2"
	>
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

// One shared AudioContext for every player — browsers cap concurrent contexts,
// and a channel can hold many voice messages.
let sharedCtx: AudioContext | null = null
function getCtx() {
	if (!sharedCtx) sharedCtx = new AudioContext()
	return sharedCtx
}

const loading = ref(true)
const failed = ref(false)
const peaks = ref<number[]>([])
const duration = ref(0)
const currentTime = ref(0)
const playing = ref(false)

const waveEl = ref<HTMLElement>()

let buffer: AudioBuffer | null = null
let source: AudioBufferSourceNode | null = null
let startedAt = 0 // ctx.currentTime when the current source started
let startOffset = 0 // buffer offset the current source started from
let rafId = 0

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

async function load() {
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
			throw new Error('no source')
		}
		buffer = await getCtx().decodeAudioData(bytes)
		duration.value = buffer.duration
		peaks.value = computePeaks(buffer)
	} catch {
		failed.value = true
	} finally {
		loading.value = false
	}
}

function tick() {
	if (!sharedCtx || !playing.value) return
	const t = startOffset + (sharedCtx.currentTime - startedAt)
	currentTime.value = Math.min(t, duration.value)
	rafId = requestAnimationFrame(tick)
}

function stopSource() {
	cancelAnimationFrame(rafId)
	if (source) {
		source.onended = null
		try {
			source.stop()
		} catch {
			// already stopped
		}
		source.disconnect()
		source = null
	}
}

// AudioBufferSourceNode is single-use — every play/seek spins up a fresh node
function startPlayback(offset: number) {
	const ctx = getCtx()
	if (!buffer) return
	stopSource()
	source = ctx.createBufferSource()
	source.buffer = buffer
	source.connect(ctx.destination)
	source.onended = () => {
		source = null
		cancelAnimationFrame(rafId)
		playing.value = false
		currentTime.value = 0
	}
	startOffset = offset
	startedAt = ctx.currentTime
	source.start(0, offset)
	playing.value = true
	tick()
}

function pause() {
	if (!sharedCtx) return
	const t = startOffset + (sharedCtx.currentTime - startedAt)
	stopSource()
	currentTime.value = Math.min(t, duration.value)
	playing.value = false
}

async function togglePlay() {
	if (!buffer) return
	const ctx = getCtx()
	if (ctx.state === 'suspended') await ctx.resume()
	if (playing.value) pause()
	else startPlayback(currentTime.value >= duration.value ? 0 : currentTime.value)
}

function seekTo(t: number) {
	const clamped = Math.min(Math.max(0, t), duration.value)
	currentTime.value = clamped
	if (playing.value) startPlayback(clamped)
	else startOffset = clamped
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

onMounted(load)
onBeforeUnmount(stopSource)
</script>
