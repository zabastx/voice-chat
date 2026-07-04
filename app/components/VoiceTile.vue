<template>
	<div
		class="border-default bg-elevated relative flex h-full w-full items-center justify-center overflow-hidden rounded-lg border"
		:class="speaking ? 'ring-success ring-2' : ''"
	>
		<video
			v-show="track"
			ref="videoEl"
			autoplay
			muted
			playsinline
			class="h-full min-h-0 w-full"
			:class="contain ? 'object-contain' : 'object-cover'"
		/>
		<UAvatar v-if="!track" :alt="label" :src="avatarUrl ?? undefined" size="xl" />
		<div
			class="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-2 py-1.5"
		>
			<UIcon v-if="icon" :name="icon" class="text-primary size-3.5 shrink-0" />
			<span class="truncate text-xs font-medium text-white">{{ label }}</span>
			<UIcon v-if="muted" class="text-error size-3.5 shrink-0" name="i-lucide-mic-off" />
		</div>
	</div>
</template>

<script lang="ts" setup>
import type { LocalTrack, RemoteTrack } from 'livekit-client'

const props = defineProps<{
	track?: LocalTrack | RemoteTrack
	label: string
	avatarUrl?: string | null
	muted?: boolean
	speaking?: boolean
	icon?: string
	contain?: boolean
}>()

const videoEl = ref<HTMLVideoElement>()

function attach() {
	if (props.track && videoEl.value) props.track.attach(videoEl.value)
}

watch(
	() => props.track,
	(_next, prev) => {
		if (prev && videoEl.value) prev.detach(videoEl.value)
		void nextTick(attach)
	}
)

onMounted(() => void nextTick(attach))
onBeforeUnmount(() => {
	if (props.track && videoEl.value) props.track.detach(videoEl.value)
})
</script>
