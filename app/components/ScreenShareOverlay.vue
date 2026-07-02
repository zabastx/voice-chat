<template>
	<!-- pills: someone is sharing -->
	<div
		v-if="voice.screenShares.value.length && !watchingSid"
		class="fixed right-4 bottom-24 z-40 space-y-2"
	>
		<div
			v-for="share in voice.screenShares.value"
			:key="share.sid"
			class="border-default bg-default flex items-center gap-3 rounded-lg border p-3 shadow-lg"
		>
			<UIcon class="text-primary size-5 shrink-0" name="i-lucide-monitor-up" />
			<p class="text-sm">
				<span class="font-semibold">{{ share.name }}</span> демонстрирует экран
			</p>
			<UButton label="Смотреть" size="xs" @click="startWatching(share.sid)" />
		</div>
	</div>

	<!-- fullscreen viewer -->
	<div v-if="watchingSid" class="fixed inset-0 z-50 flex flex-col bg-black">
		<div class="flex shrink-0 items-center justify-between px-4 py-2">
			<p class="flex items-center gap-2 text-sm text-white">
				<UIcon class="text-primary size-4" name="i-lucide-monitor-up" />
				Экран: <span class="font-semibold">{{ watchingName }}</span>
			</p>
			<UButton
				color="neutral"
				icon="i-lucide-x"
				label="Закрыть"
				size="sm"
				variant="soft"
				@click="stopWatching"
			/>
		</div>
		<video ref="videoEl" autoplay class="min-h-0 w-full flex-1 object-contain" playsinline />
	</div>
</template>

<script lang="ts" setup>
const voice = useVoice()

const watchingSid = ref<string | null>(null)
const videoEl = ref<HTMLVideoElement>()

const watchingName = computed(
	() => voice.screenShares.value.find((s) => s.sid === watchingSid.value)?.name ?? ''
)

async function startWatching(sid: string) {
	watchingSid.value = sid
	await nextTick()
	const track = voice.screenTrackFor(sid)
	if (track && videoEl.value) {
		track.attach(videoEl.value)
	}
}

function stopWatching() {
	if (watchingSid.value) {
		voice.screenTrackFor(watchingSid.value)?.detach()
	}
	watchingSid.value = null
}

// sharer stopped or we left voice — close the viewer
watch(voice.screenShares, (shares) => {
	if (watchingSid.value && !shares.some((s) => s.sid === watchingSid.value)) {
		watchingSid.value = null
	}
})
</script>
