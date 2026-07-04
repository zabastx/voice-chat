<template>
	<div class="relative flex flex-col gap-2" @dragover.prevent @drop.prevent="onDrop">
		<div
			v-if="mentionOpen"
			class="border-default bg-default absolute bottom-full left-0 z-20 mb-2 max-h-56 w-72 overflow-y-auto rounded-lg border shadow-lg"
		>
			<ul class="p-1">
				<li
					v-for="(m, i) in mentionMatches"
					:key="m.id"
					:class="i === mentionIndex ? 'bg-elevated' : ''"
					class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5"
					@mousedown.prevent="selectMention(m)"
					@mouseenter="mentionIndex = i"
				>
					<UAvatar :alt="m.username" :src="m.avatarUrl ?? undefined" size="2xs" />
					<span class="text-default truncate text-sm">{{ m.displayName || m.username }}</span>
					<span class="text-dimmed truncate text-xs">@{{ m.username }}</span>
				</li>
			</ul>
		</div>

		<div v-if="uploads.length" class="flex flex-wrap gap-2">
			<div
				v-for="upload in uploads"
				:key="upload.key"
				class="border-default bg-elevated/50 flex items-center gap-2 rounded-md border px-2 py-1"
			>
				<UIcon
					v-if="upload.uploading"
					class="text-muted size-4 animate-spin"
					name="i-lucide-loader-2"
				/>
				<UIcon v-else-if="upload.error" class="text-error size-4" name="i-lucide-circle-alert" />
				<UIcon v-else class="text-primary size-4" name="i-lucide-paperclip" />
				<span
					:class="upload.error ? 'text-error' : 'text-default'"
					class="max-w-40 truncate text-xs"
				>
					{{ upload.file.name }}
				</span>
				<UButton
					color="neutral"
					icon="i-lucide-x"
					size="xs"
					variant="ghost"
					@click="removeUpload(upload)"
				/>
			</div>
		</div>

		<div v-if="recording" class="flex items-center gap-2">
			<UButton color="neutral" icon="i-lucide-x" variant="ghost" @click="cancel()" />
			<div
				class="border-default bg-elevated/50 flex flex-1 items-center gap-2 rounded-lg border px-3 py-2"
			>
				<span class="bg-error size-2.5 shrink-0 animate-pulse rounded-full" />
				<UIcon class="text-error size-4 shrink-0" name="i-lucide-mic" />
				<span class="text-default text-sm tabular-nums">{{ formatDuration(elapsed) }}</span>
				<span class="text-muted flex-1 truncate text-xs">Идёт запись…</span>
			</div>
			<UButton color="primary" icon="i-lucide-square" @click="stop()" />
		</div>
		<div v-else-if="previewBlob" class="flex items-center gap-2">
			<UButton color="neutral" icon="i-lucide-trash-2" variant="ghost" @click="discardPreview()" />
			<div class="min-w-0 flex-1">
				<VoiceMessagePlayer :blob="previewBlob" />
			</div>
			<UButton
				:loading="sending"
				color="primary"
				icon="i-lucide-send-horizontal"
				@click="() => sendVoice()"
			/>
		</div>
		<div v-else class="flex items-end gap-2">
			<UButton
				:disabled="disabled"
				color="neutral"
				icon="i-lucide-plus"
				variant="ghost"
				@click="fileInput?.click()"
			/>
			<UButton
				:disabled="disabled"
				color="neutral"
				icon="i-lucide-mic"
				variant="ghost"
				@click="() => start()"
			/>
			<input ref="fileInput" class="hidden" multiple type="file" @change="onPick" />
			<UTextarea
				v-model="text"
				:maxrows="8"
				:placeholder="placeholder"
				:rows="1"
				autoresize
				class="flex-1"
				@blur="closeMentions"
				@click="syncMentions"
				@keydown="onKeydown"
				@keyup="syncMentions"
				@paste="onPaste"
			/>
			<UButton :disabled="!canSend || disabled" icon="i-lucide-send-horizontal" @click="submit" />
		</div>
	</div>
</template>

<script lang="ts" setup>
defineProps<{
	placeholder: string
	disabled?: boolean
}>()

const emit = defineEmits<{ send: [content: string, attachmentIds: string[]] }>()

interface PendingUpload {
	key: string
	file: File
	uploading: boolean
	error: boolean
	attachment?: AttachmentDto
}

const toast = useToast()
const previewBlob = ref<Blob | null>(null)
const { recording, elapsed, start, stop, cancel } = useVoiceRecorder((blob) => {
	previewBlob.value = blob
})
const text = ref('')
const sending = ref(false)
const uploads = ref<PendingUpload[]>([])
const fileInput = ref<HTMLInputElement>()

// --- @mention autocomplete ---
const membersStore = useMembersStore()
const taEl = ref<HTMLTextAreaElement | null>(null)
const mentionQuery = ref<string | null>(null)
const mentionStart = ref(0)
const mentionIndex = ref(0)

const mentionMatches = computed<MemberDto[]>(() => {
	if (mentionQuery.value === null) return []
	const q = mentionQuery.value.toLowerCase()
	return Object.values(membersStore.members.value)
		.filter(
			(m) =>
				m.username.toLowerCase().startsWith(q) || (m.displayName ?? '').toLowerCase().startsWith(q)
		)
		.sort((a, b) => a.username.localeCompare(b.username))
		.slice(0, 6)
})
const mentionOpen = computed(() => mentionQuery.value !== null && mentionMatches.value.length > 0)

// recompute the active `@query` from the caret position on every caret move
function syncMentions(event: Event) {
	const el = event.target as HTMLTextAreaElement
	taEl.value = el
	const caret = el.selectionStart ?? el.value.length
	const match = el.value.slice(0, caret).match(/(?:^|\s)@([\p{L}\p{N}_-]*)$/u)
	if (match) {
		const query = match[1]!
		mentionStart.value = caret - query.length - 1
		if (query !== mentionQuery.value) mentionIndex.value = 0
		mentionQuery.value = query
	} else {
		mentionQuery.value = null
	}
}

function closeMentions() {
	mentionQuery.value = null
}

function selectMention(member: MemberDto) {
	const el = taEl.value
	if (!el) return
	const caret = el.selectionStart ?? text.value.length
	const insert = `@${member.username} `
	text.value = text.value.slice(0, mentionStart.value) + insert + text.value.slice(caret)
	const pos = mentionStart.value + insert.length
	mentionQuery.value = null
	nextTick(() => {
		el.focus()
		el.setSelectionRange(pos, pos)
	})
}

function onKeydown(event: KeyboardEvent) {
	if (mentionOpen.value) {
		const count = mentionMatches.value.length
		if (event.key === 'ArrowDown') {
			event.preventDefault()
			mentionIndex.value = (mentionIndex.value + 1) % count
			return
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault()
			mentionIndex.value = (mentionIndex.value - 1 + count) % count
			return
		}
		if (event.key === 'Enter' || event.key === 'Tab') {
			event.preventDefault()
			selectMention(mentionMatches.value[mentionIndex.value] ?? mentionMatches.value[0]!)
			return
		}
		if (event.key === 'Escape') {
			event.preventDefault()
			closeMentions()
			return
		}
	}
	// plain Enter (no modifiers) sends; Shift+Enter keeps the default newline
	if (
		event.key === 'Enter' &&
		!event.shiftKey &&
		!event.ctrlKey &&
		!event.altKey &&
		!event.metaKey
	) {
		event.preventDefault()
		submit()
	}
}

const canSend = computed(
	() =>
		(text.value.trim().length > 0 || uploads.value.some((u) => u.attachment)) &&
		!uploads.value.some((u) => u.uploading)
)

function addFiles(files: Iterable<File>) {
	for (const file of files) {
		const upload = reactive<PendingUpload>({
			key: `${file.name}-${Date.now()}-${Math.random()}`,
			file,
			uploading: true,
			error: false
		})
		uploads.value.push(upload)
		uploadFile(upload)
	}
}

async function uploadFile(upload: PendingUpload) {
	try {
		const body = new FormData()
		body.append('file', upload.file)
		upload.attachment = await $fetch<AttachmentDto>('/api/attachments', { method: 'POST', body })
	} catch (e) {
		upload.error = true
		toast.add({
			title:
				(e as { data?: { message?: string } }).data?.message ??
				`Не удалось загрузить ${upload.file.name}`,
			color: 'error'
		})
	} finally {
		upload.uploading = false
	}
}

function removeUpload(upload: PendingUpload) {
	uploads.value = uploads.value.filter((u) => u.key !== upload.key)
}

function onPick(event: Event) {
	const input = event.target as HTMLInputElement
	if (input.files?.length) addFiles(input.files)
	input.value = ''
}

function onPaste(event: ClipboardEvent) {
	const files = event.clipboardData?.files
	if (files?.length) {
		event.preventDefault()
		addFiles(files)
	}
}

function onDrop(event: DragEvent) {
	const files = event.dataTransfer?.files
	if (files?.length) addFiles(files)
}

function submit() {
	if (!canSend.value) return
	const attachmentIds = uploads.value.filter((u) => u.attachment).map((u) => u.attachment!.id)
	emit('send', text.value.trim(), attachmentIds)
	text.value = ''
	uploads.value = []
	mentionQuery.value = null
}

function extFromMime(mime: string) {
	const base = mime.split(';')[0]
	if (base === 'audio/mp4') return 'm4a'
	if (base === 'audio/ogg') return 'ogg'
	return 'webm'
}

function discardPreview() {
	previewBlob.value = null
}

// upload the reviewed clip through the normal attachment pipeline, then send
async function sendVoice() {
	const blob = previewBlob.value
	if (!blob || sending.value) return
	const file = new File([blob], `voice-message-${Date.now()}.${extFromMime(blob.type)}`, {
		type: blob.type
	})
	const upload = reactive<PendingUpload>({
		key: `${file.name}-${Math.random()}`,
		file,
		uploading: true,
		error: false
	})
	uploads.value.push(upload)
	sending.value = true
	try {
		await uploadFile(upload)
		if (upload.attachment) {
			emit('send', '', [upload.attachment.id])
			uploads.value = uploads.value.filter((u) => u.key !== upload.key)
			previewBlob.value = null
		}
		// on error uploadFile already toasts and leaves the chip so the user sees it
	} finally {
		sending.value = false
	}
}
</script>
