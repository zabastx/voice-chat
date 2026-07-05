<template>
	<nav class="flex flex-col gap-5">
		<div>
			<div class="mb-1 flex items-center justify-between px-1.5">
				<span class="text-muted text-xs font-semibold uppercase">Текстовые каналы</span>
				<UButton
					v-if="canModerate"
					color="neutral"
					icon="i-lucide-plus"
					size="xs"
					variant="ghost"
					@click="openCreate('text')"
				/>
			</div>
			<div class="flex flex-col gap-0.5">
				<div v-for="channel in store.textChannels.value" :key="channel.id" class="group relative">
					<ULink
						class="hover:bg-elevated flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
						:class="
							store.activeChannelId.value === channel.id
								? 'bg-elevated text-highlighted'
								: store.isUnread(channel)
									? 'text-highlighted font-medium'
									: 'text-muted'
						"
						:to="`/channels/${channel.id}`"
					>
						<UIcon class="size-4 shrink-0" name="i-lucide-hash" />
						<span class="flex-1 truncate">{{ channel.name }}</span>
						<span
							v-if="store.isUnread(channel)"
							class="bg-primary size-2 shrink-0 rounded-full group-hover:hidden"
						/>
					</ULink>
					<UDropdownMenu v-if="canModerate" :items="channelMenu(channel)">
						<UButton
							class="absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover:opacity-100"
							color="neutral"
							icon="i-lucide-ellipsis"
							size="xs"
							variant="ghost"
						/>
					</UDropdownMenu>
				</div>
			</div>
		</div>

		<div>
			<div class="mb-1 flex items-center justify-between px-1.5">
				<span class="text-muted text-xs font-semibold uppercase">Голосовые каналы</span>
				<UButton
					v-if="canModerate"
					color="neutral"
					icon="i-lucide-plus"
					size="xs"
					variant="ghost"
					@click="openCreate('voice')"
				/>
			</div>
			<div class="flex flex-col gap-0.5">
				<div v-for="channel in store.voiceChannels.value" :key="channel.id" class="group relative">
					<button
						class="hover:bg-elevated flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm"
						:class="
							store.activeChannelId.value === channel.id
								? 'bg-elevated text-highlighted'
								: 'text-muted'
						"
						type="button"
						@click="openVoice(channel.id)"
					>
						<UIcon class="size-4 shrink-0" name="i-lucide-volume-2" />
						<span class="flex-1 truncate text-left">{{ channel.name }}</span>
					</button>
					<UDropdownMenu v-if="canModerate" :items="channelMenu(channel)">
						<UButton
							class="absolute top-1.5 right-1 opacity-0 group-hover:opacity-100"
							color="neutral"
							icon="i-lucide-ellipsis"
							size="xs"
							variant="ghost"
						/>
					</UDropdownMenu>
					<VoiceUserMenu
						v-for="participant in rooms[channel.id] ?? []"
						:key="participant.memberId"
						:disabled="!canAdjust(channel.id, participant)"
						:identity="participant.memberId"
					>
						<div
							class="ml-4 flex items-center gap-2 rounded-md py-1 pl-2 transition-colors"
							:class="
								canAdjust(channel.id, participant) ? 'hover:bg-elevated cursor-context-menu' : ''
							"
						>
							<UAvatar
								:alt="participantName(participant)"
								:class="isSpeaking(channel.id, participant) ? 'ring-success ring-2' : ''"
								:src="membersStore.profile(participant.memberId)?.avatarUrl ?? undefined"
								size="2xs"
							/>
							<span class="text-muted truncate text-sm">{{ participantName(participant) }}</span>
							<UIcon
								v-if="isMuted(participant)"
								class="text-dimmed size-3.5 shrink-0"
								name="i-lucide-mic-off"
							/>
							<UIcon
								v-if="isCameraOn(participant)"
								class="text-primary size-3.5 shrink-0"
								name="i-lucide-video"
							/>
							<UIcon
								v-if="participant.screenSharing"
								class="text-primary size-3.5 shrink-0"
								name="i-lucide-monitor-up"
							/>
							<UIcon
								v-if="
									canAdjust(channel.id, participant) && voice.isLocallyMuted(participant.memberId)
								"
								class="text-dimmed size-3.5 shrink-0"
								name="i-lucide-volume-x"
							/>
						</div>
					</VoiceUserMenu>
				</div>
			</div>
		</div>

		<div>
			<div class="mb-1 flex items-center justify-between px-1.5">
				<span class="text-muted text-xs font-semibold uppercase">Личные сообщения</span>
				<UButton
					aria-label="Новое сообщение"
					color="neutral"
					icon="i-lucide-plus"
					size="xs"
					variant="ghost"
					@click="
						() => {
							dmModal.open()
						}
					"
				/>
			</div>
			<div class="flex flex-col gap-0.5">
				<ULink
					v-for="convo in dm.sorted.value"
					:key="convo.channelId"
					class="hover:bg-elevated group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
					:class="
						dm.activeChannelId.value === convo.channelId
							? 'bg-elevated text-highlighted'
							: dm.isUnread(convo)
								? 'text-highlighted font-medium'
								: 'text-muted'
					"
					:to="`/channels/${convo.channelId}`"
				>
					<UChip
						color="success"
						inset
						position="bottom-right"
						:show="onlineSet.has(convo.member.id)"
						size="sm"
					>
						<UAvatar :alt="dmName(convo)" size="2xs" :src="convo.member.avatarUrl ?? undefined" />
					</UChip>
					<span class="flex-1 truncate">{{ dmName(convo) }}</span>
					<span
						v-if="dm.isUnread(convo)"
						class="bg-primary size-2 shrink-0 rounded-full group-hover:hidden"
					/>
				</ULink>
				<p v-if="!dm.sorted.value.length" class="text-dimmed px-2 py-1 text-xs">
					Пока нет диалогов
				</p>
			</div>
		</div>
	</nav>
</template>

<script lang="ts" setup>
import type { DropdownMenuItem } from '@nuxt/ui'

import ChannelFormModal from './ChannelFormModal.vue'
import ConfirmModal from './ConfirmModal.vue'
import DmCreateModal from './DmCreateModal.vue'

const store = useChannelsStore()
const membersStore = useMembersStore()
const dm = useDmStore()
const voice = useVoice()
const { voice: rooms, online } = useRealtime()
const { user } = useUserSession()
const { isAdmin, canModerate } = useRole()
const toast = useToast()

const overlay = useOverlay()
const channelModal = overlay.create(ChannelFormModal)
const confirmModal = overlay.create(ConfirmModal)
const dmModal = overlay.create(DmCreateModal)

const onlineSet = computed(() => new Set(online.value))
const dmName = (convo: DmConversationDto) => convo.member.displayName ?? convo.member.username

function openCreate(kind: 'text' | 'voice') {
	channelModal.open({ defaultKind: kind })
}

// clicking a voice channel joins it (Discord-style) and opens its call view
function openVoice(channelId: string) {
	void voice.join(channelId)
	void navigateTo(`/channels/${channelId}`)
}

// the server roster carries no live speaking data; merge in what the local
// LiveKit connection knows about the room we are in
function isSpeaking(channelId: string, participant: VoiceParticipant) {
	return (
		participant.speaking ||
		(voice.currentChannelId.value === channelId &&
			voice.speakingIds.value.includes(participant.memberId))
	)
}

function participantName(participant: VoiceParticipant) {
	const profile = membersStore.profile(participant.memberId)
	return profile?.displayName ?? participant.username
}

function isMuted(participant: VoiceParticipant) {
	return participant.memberId === user.value?.id ? voice.muted.value : participant.muted
}

function isCameraOn(participant: VoiceParticipant) {
	return participant.memberId === user.value?.id ? voice.camera.value : participant.cameraOn
}

// local volume/mute only works for other people in the channel we are connected to
function canAdjust(channelId: string, participant: VoiceParticipant) {
	return voice.currentChannelId.value === channelId && participant.memberId !== user.value?.id
}

function channelMenu(channel: ChannelDto): DropdownMenuItem[][] {
	const groups: DropdownMenuItem[][] = [
		[
			{
				label: 'Переименовать',
				icon: 'i-lucide-pencil',
				onSelect: () => {
					channelModal.open({ channel })
				}
			}
		]
	]
	// deleting a channel wipes its history — admin only
	if (isAdmin.value) {
		groups.push([
			{
				label: 'Удалить',
				icon: 'i-lucide-trash-2',
				color: 'error',
				onSelect: () => deleteChannel(channel)
			}
		])
	}
	return groups
}

async function deleteChannel(channel: ChannelDto) {
	const instance = confirmModal.open({
		title: `Удалить #${channel.name}?`,
		description:
			channel.kind === 'text'
				? 'Все сообщения в этом канале будут удалены навсегда.'
				: 'Голосовой канал будет удалён.'
	})
	if (!(await instance.result)) return
	try {
		await $fetch(`/api/channels/${channel.id}`, { method: 'DELETE' })
	} catch {
		toast.add({ title: 'Не удалось удалить канал', color: 'error' })
	}
}
</script>
