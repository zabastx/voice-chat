<template>
	<div
		:class="[compact ? 'py-0.5' : 'pt-3 pb-0.5', { 'chat-flash': flash }]"
		:data-message-id="message.id"
		class="group hover:bg-elevated/50 relative flex gap-3 rounded-md px-2"
	>
		<UAvatar
			v-if="!compact"
			:alt="authorName"
			:src="author?.avatarUrl ?? undefined"
			class="mt-0.5 shrink-0"
			size="sm"
		/>
		<div v-else class="w-7 shrink-0 text-right">
			<span
				class="text-dimmed invisible text-[10px] leading-5 whitespace-nowrap group-hover:visible"
			>
				{{ formatTime(message.createdAt) }}
			</span>
		</div>

		<div class="min-w-0 flex-1">
			<div v-if="!compact" class="flex items-baseline gap-2">
				<span class="text-highlighted text-sm font-semibold">{{ authorName }}</span>
				<span class="text-dimmed text-xs">{{ formatTimestamp(message.createdAt) }}</span>
			</div>

			<template v-if="!editing">
				<!-- eslint-disable-next-line vue/no-v-html -- sanitized in renderMarkdown -->
				<div
					v-if="message.content"
					class="chat-prose text-default text-sm break-words"
					v-html="rendered"
				/>
				<MessageAttachments v-if="message.attachments.length" :attachments="message.attachments" />
			</template>

			<div v-else class="py-1">
				<UTextarea
					v-model="draft"
					:rows="1"
					autofocus
					autoresize
					class="w-full"
					@keydown.enter.exact.prevent="emit('saveEdit', draft)"
					@keydown.esc="emit('cancelEdit')"
				/>
				<p class="text-muted mt-1 text-xs">Enter — сохранить · Esc — отменить</p>
			</div>
		</div>

		<div
			v-if="!editing && (canEdit || canDelete)"
			class="border-default bg-default absolute -top-3 right-2 hidden gap-0.5 rounded-md border p-0.5 shadow-sm group-hover:flex"
		>
			<UButton
				v-if="canEdit"
				color="neutral"
				icon="i-lucide-pencil"
				size="xs"
				variant="ghost"
				@click="emit('startEdit')"
			/>
			<UButton
				v-if="canDelete"
				color="error"
				icon="i-lucide-trash-2"
				size="xs"
				variant="ghost"
				@click="emit('remove')"
			/>
		</div>
	</div>
</template>

<script lang="ts" setup>
const props = defineProps<{
	message: MessageDto
	compact: boolean
	editing: boolean
	canEdit: boolean
	canDelete: boolean
	// briefly highlighted after a reply/search jump
	flash?: boolean
}>()

const emit = defineEmits<{
	startEdit: []
	cancelEdit: []
	saveEdit: [content: string]
	remove: []
}>()

const membersStore = useMembersStore()
const author = computed(() => membersStore.profile(props.message.authorId))

// Sanitized markdown HTML. The "(изменено)" marker is appended after
// sanitization (trusted constant) — inline inside the trailing paragraph for
// the common single-paragraph case, otherwise on its own line.
const rendered = computed(() => {
	const html = renderMarkdown(props.message.content)
	if (!props.message.editedAt) return html
	const marker = '<span class="chat-edited">(изменено)</span>'
	return html.endsWith('</p>') ? `${html.slice(0, -4)}${marker}</p>` : html + marker
})
const authorName = computed(
	() => author.value?.displayName ?? author.value?.username ?? props.message.authorName
)

const draft = ref('')

watch(
	() => props.editing,
	(editing) => {
		if (editing) draft.value = props.message.content
	}
)
</script>
