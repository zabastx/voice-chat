<template>
	<UPopover v-model:open="open" :content="{ align: 'end' }">
		<UButton color="neutral" icon="i-lucide-smile-plus" size="xs" variant="ghost" />

		<template #content>
			<div class="p-2">
				<div class="mb-2 flex gap-1">
					<button
						v-for="emoji in QUICK"
						:key="emoji"
						class="hover:bg-elevated rounded p-1 text-lg leading-none"
						type="button"
						@click="pick(emoji)"
					>
						{{ emoji }}
					</button>
				</div>
				<div v-if="ready" :class="isDark ? 'dark' : 'light'">
					<emoji-picker style="height: 300px" @emoji-click="onEmojiClick" />
				</div>
				<div v-else class="flex h-16 items-center justify-center">
					<UIcon class="text-muted size-5 animate-spin" name="i-lucide-loader-2" />
				</div>
			</div>
		</template>
	</UPopover>
</template>

<script lang="ts" setup>
const emit = defineEmits<{ select: [emoji: string] }>()

const QUICK = ['👍', '❤️', '😂', '🎉', '😮', '😢']

const open = ref(false)
const ready = ref(false)
const colorMode = useColorMode()
const isDark = computed(() => colorMode.value === 'dark')

// register the <emoji-picker> web component lazily, client-side only (SSR-safe,
// same pattern as livekit-client in useVoice)
onMounted(async () => {
	await import('emoji-picker-element')
	ready.value = true
})

function pick(emoji: string) {
	emit('select', emoji)
	open.value = false
}

function onEmojiClick(event: Event) {
	const detail = (event as CustomEvent<{ unicode?: string }>).detail
	if (detail?.unicode) pick(detail.unicode)
}
</script>
