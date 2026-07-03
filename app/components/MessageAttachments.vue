<template>
	<div class="mt-1 flex flex-wrap gap-2">
		<template v-for="attachment in attachments" :key="attachment.id">
			<a
				v-if="attachment.mime.startsWith('image/')"
				:href="`/api/attachments/${attachment.id}`"
				rel="noopener"
				target="_blank"
			>
				<img
					:alt="attachment.filename"
					:src="`/api/attachments/${attachment.id}`"
					class="border-default max-h-72 max-w-full rounded-lg border object-contain"
					loading="lazy"
				/>
			</a>
			<VoiceMessagePlayer
				v-else-if="attachment.mime.startsWith('audio/')"
				:attachment="attachment"
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
	</div>
</template>

<script lang="ts" setup>
defineProps<{ attachments: AttachmentDto[] }>()

function formatSize(bytes: number) {
	if (bytes < 1024) return `${bytes} Б`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`
	return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`
}
</script>
