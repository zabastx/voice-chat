<template>
	<div class="flex flex-col gap-2" @dragover.prevent @drop.prevent="onDrop">
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

		<div class="flex items-end gap-2">
			<UButton
				:disabled="disabled"
				color="neutral"
				icon="i-lucide-plus"
				variant="ghost"
				@click="fileInput?.click()"
			/>
			<input ref="fileInput" class="hidden" multiple type="file" @change="onPick" />
			<UTextarea
				v-model="text"
				:maxrows="8"
				:placeholder="placeholder"
				:rows="1"
				autoresize
				class="flex-1"
				@keydown.enter.exact.prevent="submit"
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
const text = ref('')
const uploads = ref<PendingUpload[]>([])
const fileInput = ref<HTMLInputElement>()

const canSend = computed(
	() =>
		(text.value.trim().length > 0 || uploads.value.some((u) => u.attachment)) &&
		!uploads.value.some((u) => u.uploading)
)

function addFiles(files: Iterable<File>) {
	for (const file of files) {
		const upload: PendingUpload = {
			key: `${file.name}-${Date.now()}-${Math.random()}`,
			file,
			uploading: true,
			error: false
		}
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
}
</script>
