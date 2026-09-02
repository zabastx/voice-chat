<template>
	<div
		:class="[compact ? 'py-0.5' : 'pt-3 pb-0.5', { 'chat-flash': flash }]"
		:data-message-id="message.id"
		class="group hover:bg-elevated/50 relative flex gap-3 rounded-md px-2"
		@focusin="wantsToolbar = true"
		@pointerenter="wantsToolbar = true"
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
			<button
				v-if="message.replyTo"
				:disabled="message.replyTo.deleted"
				class="text-muted mb-0.5 flex max-w-full items-center gap-1 text-xs"
				:class="message.replyTo.deleted ? 'cursor-default' : 'hover:text-default cursor-pointer'"
				type="button"
				@click="onQuoteClick"
			>
				<UIcon class="size-3 shrink-0 -scale-x-100" name="i-lucide-reply" />
				<span v-if="message.replyTo.deleted" class="text-dimmed italic">
					исходное сообщение удалено
				</span>
				<template v-else>
					<span class="text-primary shrink-0">@{{ message.replyTo.authorName }}</span>
					<span class="truncate">{{ message.replyTo.preview || 'вложение' }}</span>
				</template>
			</button>

			<div v-if="!compact" class="flex items-baseline gap-2">
				<UDropdownMenu v-if="canDm" :items="authorMenu">
					<button
						class="text-highlighted cursor-pointer text-sm font-semibold hover:underline"
						type="button"
					>
						{{ authorName }}
					</button>
				</UDropdownMenu>
				<span v-else class="text-highlighted text-sm font-semibold">{{ authorName }}</span>
				<span class="text-dimmed text-xs">{{ formatTimestamp(message.createdAt) }}</span>
				<span v-if="sourceLabel" class="text-dimmed bg-elevated rounded px-1 py-0.5 text-[10px]">
					через {{ sourceLabel }}
				</span>
			</div>

			<template v-if="!editing">
				<!-- eslint-disable-next-line vue/no-v-html -- sanitized in renderMarkdown -->
				<div
					v-if="message.content"
					class="chat-prose text-default text-sm break-words"
					v-html="rendered"
				/>
				<YoutubeEmbed
					v-for="embed in embeds"
					:key="embed.videoId"
					:kind="embed.kind"
					:start-sec="embed.startSec"
					:url="embed.url"
					:video-id="embed.videoId"
				/>
				<MessageAttachments v-if="message.attachments.length" :attachments="message.attachments" />

				<div v-if="message.reactions.length" class="mt-1 flex flex-wrap gap-1">
					<UTooltip
						v-for="reaction in message.reactions"
						:key="reaction.emoji"
						:text="reactorNames(reaction)"
					>
						<button
							class="flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs"
							:class="
								reaction.memberIds.includes(user?.id ?? '')
									? 'border-primary bg-primary/10 text-primary'
									: 'border-default bg-elevated/50 text-default hover:bg-elevated'
							"
							type="button"
							@click="emit('react', reaction.emoji)"
						>
							<span>{{ reaction.emoji }}</span>
							<span class="tabular-nums">{{ reaction.count }}</span>
						</button>
					</UTooltip>
				</div>
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

		<!--
			Mounted on first hover, not up front: the toolbar is a popover trigger plus
			three buttons, and a full render window is 150 rows. Building all of them for
			a bar that is invisible until the pointer arrives cost several hundred
			component instances per channel. Once mounted it stays — the CSS below still
			does the showing and hiding, so there is no remount on every pass of the mouse.
		-->
		<div
			v-if="!editing && wantsToolbar"
			class="border-default bg-default pointer-events-none absolute -top-3 right-2 flex gap-0.5 rounded-md border p-0.5 opacity-0 shadow-sm group-hover:pointer-events-auto group-hover:opacity-100 has-[[data-state=open]]:pointer-events-auto has-[[data-state=open]]:opacity-100"
		>
			<ReactionPicker @select="emit('react', $event)" />
			<UButton
				color="neutral"
				icon="i-lucide-reply"
				size="xs"
				variant="ghost"
				@click="emit('reply')"
			/>
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
import type { DropdownMenuItem } from '@nuxt/ui'

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
	reply: []
	react: [emoji: string]
	jump: [messageId: string]
}>()

const { user } = useUserSession()
const dm = useDmStore()
const toast = useToast()

// see the hover toolbar in the template — it is built on first hover/focus
const wantsToolbar = ref(false)

// you can DM any author other than yourself, straight from their name
const canDm = computed(() => props.message.authorId !== user.value?.id)
const authorMenu = computed<DropdownMenuItem[][]>(() => [
	[
		{
			label: 'Написать',
			icon: 'i-lucide-message-square',
			onSelect: async () => {
				try {
					await dm.openDm(props.message.authorId)
				} catch {
					toast.add({ title: 'Не удалось открыть диалог', color: 'error' })
				}
			}
		}
	]
])

function onQuoteClick() {
	if (props.message.replyTo && !props.message.replyTo.deleted) {
		emit('jump', props.message.replyTo.id)
	}
}

function reactorNames(reaction: ReactionDto): string {
	return reaction.memberIds
		.map((id) => {
			const member = membersStore.profile(id)
			return member?.displayName || member?.username || 'кто-то'
		})
		.join(', ')
}

const membersStore = useMembersStore()
const author = computed(() => membersStore.profile(props.message.authorId))

// Sanitized markdown HTML with mention chips resolved from the live member
// directory. The "(изменено)" marker is appended after sanitization (trusted
// constant) — inline inside the trailing paragraph for the common
// single-paragraph case, otherwise on its own line.
const rendered = computed(() => {
	const html = renderMessage(props.message.content, membersStore.members.value)
	if (!props.message.editedAt) return html
	const marker = '<span class="chat-edited">(изменено)</span>'
	return html.endsWith('</p>') ? `${html.slice(0, -4)}${marker}</p>` : html + marker
})
const authorName = computed(
	() => author.value?.displayName ?? author.value?.username ?? props.message.authorName
)

// A message posted through a messenger bridge is badged with which one, so a
// bridged reply is never mistaken for a native send (adr/0007, adr/0011).
// 'app' has no badge.
const SOURCE_LABELS: Partial<Record<MessageDto['source'], string>> = {
	telegram: 'Telegram',
	vk: 'VK'
}
const sourceLabel = computed(() => SOURCE_LABELS[props.message.source])

// Read off the plain markdown pass, not `rendered` — embeds don't depend on the
// member directory, and renderMarkdown is memoized so this costs a cache hit.
const embeds = computed(() =>
	messageEmbeds(renderMarkdown(props.message.content), props.message.content)
)

const draft = ref('')

watch(
	() => props.editing,
	(editing) => {
		if (editing) {
			draft.value = decodeMentions(props.message.content, Object.values(membersStore.members.value))
		}
	}
)
</script>
