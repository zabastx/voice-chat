<template>
	<div class="mt-1 flex flex-wrap gap-2">
		<template v-for="attachment in attachments" :key="attachment.id">
			<button
				v-if="attachment.mime.startsWith('image/')"
				class="cursor-pointer"
				type="button"
				@click="openId = attachment.id"
			>
				<img
					:alt="attachment.filename"
					:src="`/api/attachments/${attachment.id}`"
					class="border-default max-h-72 max-w-full rounded-lg border object-contain"
					loading="lazy"
				/>
			</button>
			<video
				v-else-if="attachment.mime.startsWith('video/')"
				:src="`/api/attachments/${attachment.id}`"
				class="border-default max-h-72 max-w-full rounded-lg border"
				controls
				preload="metadata"
			/>
			<VoiceMessagePlayer
				v-else-if="attachment.mime.startsWith('audio/') && isVoiceMessage(attachment)"
				:attachment="attachment"
			/>
			<audio
				v-else-if="attachment.mime.startsWith('audio/')"
				:src="`/api/attachments/${attachment.id}`"
				class="w-72 max-w-full"
				controls
				preload="metadata"
			/>
			<a
				v-else
				:href="`/api/attachments/${attachment.id}`"
				class="border-default bg-elevated/50 hover:bg-elevated flex items-center gap-2 rounded-lg border px-3 py-2"
				rel="noopener"
				target="_blank"
			>
				<UIcon class="text-primary size-5 shrink-0" name="i-lucide-file" />
				<div class="min-w-0">
					<p class="text-default truncate text-sm">{{ attachment.filename }}</p>
					<p class="text-muted text-xs">{{ formatSize(attachment.size) }}</p>
				</div>
			</a>
		</template>

		<ImageLightbox
			v-if="openImage"
			:filename="openImage.filename"
			:open="true"
			:src="`/api/attachments/${openImage.id}`"
			@update:open="openId = null"
		/>
	</div>
</template>

<script lang="ts" setup>
const props = defineProps<{ attachments: AttachmentDto[] }>()

const openId = ref<string | null>(null)
const openImage = computed(() => props.attachments.find((a) => a.id === openId.value) ?? null)

// Recorded voice notes are named `voice-message-<ts>.<ext>` in MessageComposer;
// they get the waveform player, other audio uploads get a native <audio> element.
function isVoiceMessage(attachment: AttachmentDto) {
	return attachment.filename.startsWith('voice-message-')
}

function formatSize(bytes: number) {
	if (bytes < 1024) return `${bytes} Б`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
	return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
</script>
