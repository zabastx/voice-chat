<template>
	<div
		class="border-default bg-elevated/30 mt-1 overflow-hidden rounded-lg border"
		:class="kind === 'shorts' ? 'w-[200px] max-w-full' : 'w-full max-w-md'"
	>
		<div :class="kind === 'shorts' ? 'aspect-[9/16]' : 'aspect-video'" class="relative">
			<button
				v-if="!playing"
				class="group/embed absolute inset-0 cursor-pointer"
				type="button"
				aria-label="Воспроизвести видео"
				@click="playing = true"
			>
				<!-- hqdefault is the only size YouTube guarantees exists; it is 4:3, so
					 the letterbox (or, for Shorts, pillarbox) bars are cropped away by
					 object-cover rather than drawn. no-referrer keeps the app URL out of
					 Google's logs — the thumbnail request itself is unavoidable. -->
				<img
					:src="`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`"
					alt=""
					class="size-full object-cover"
					loading="lazy"
					referrerpolicy="no-referrer"
				/>
				<span
					class="absolute inset-0 flex items-center justify-center bg-black/20 transition-colors group-hover/embed:bg-black/35"
				>
					<!-- Inline SVG rather than <UIcon name="i-lucide-play">: that icon
						 currently resolves to Nuxt UI's loading placeholder (a spinner arc)
						 app-wide — see the same symptom on VoiceMessagePlayer and
						 WatchStage. A filled triangle also reads better at this size than
						 lucide's outlined one. -->
					<span
						class="flex size-14 items-center justify-center rounded-full bg-black/65 text-white transition-transform group-hover/embed:scale-110"
					>
						<svg class="ml-1 size-6" fill="currentColor" viewBox="0 0 24 24">
							<path d="M8 5v14l11-7z" />
						</svg>
					</span>
				</span>
			</button>
			<!-- youtube-nocookie + the allow list YouTube's own embed code ships;
				 `autoplay` has to be in it at navigation time or the click that
				 mounted this frame doesn't carry through to playback -->
			<iframe
				v-else
				:src="embedSrc"
				:allow="EMBED_ALLOW"
				allowfullscreen
				class="size-full"
				referrerpolicy="strict-origin-when-cross-origin"
				title="Видео YouTube"
			/>
		</div>

		<div v-if="inVoiceChannel" class="flex justify-end px-1.5 py-1">
			<UButton
				:loading="starting"
				color="neutral"
				icon="i-lucide-tv"
				label="Смотреть вместе"
				size="xs"
				variant="ghost"
				@click="startTogether"
			/>
		</div>
	</div>
</template>

<script lang="ts" setup>
// Bound rather than written inline so the formatter can't wrap it: a permissions
// policy split across lines is a different (and unparsed) string.
const EMBED_ALLOW =
	'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'

const props = defineProps<{
	// `videoId`, not `ref` — `ref` is a reserved attribute on a component tag
	videoId: string
	startSec: number
	kind: 'video' | 'shorts'
	url: string
}>()

const voice = useVoice()
const watchSession = useWatch()
const toast = useToast()

const playing = ref(false)
const starting = ref(false)

const embedSrc = computed(() => {
	const params = new URLSearchParams({
		autoplay: '1',
		playsinline: '1',
		rel: '0',
		modestbranding: '1'
	})
	if (props.startSec > 0) params.set('start', String(props.startSec))
	return `https://www.youtube-nocookie.com/embed/${props.videoId}?${params}`
})

// The button is only actionable from inside a voice channel — the Audience is
// the roster (adr/0009), so there is no room to start a session in otherwise.
const inVoiceChannel = computed(() => Boolean(voice.currentChannelId.value))

async function startTogether() {
	starting.value = true
	try {
		// hand over the original href, not the parsed id: the server is the
		// authority on what a link means, and this way `t=90` survives
		await watchSession.start(props.url)
	} catch (e) {
		toast.add({
			title: (e as { data?: { message?: string } }).data?.message ?? 'Не удалось включить видео',
			color: 'error'
		})
	} finally {
		starting.value = false
	}
}
</script>
