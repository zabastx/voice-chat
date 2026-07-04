<template>
	<nav class="flex flex-col gap-5">
		<div>
			<div class="mb-1 flex items-center justify-between px-1.5">
				<span class="text-muted text-xs font-semibold uppercase">Текстовые каналы</span>
				<UButton
					v-if="user?.isAdmin"
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
					<UDropdownMenu v-if="user?.isAdmin" :items="channelMenu(channel)">
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
					v-if="user?.isAdmin"
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
					<UDropdownMenu v-if="user?.isAdmin" :items="channelMenu(channel)">
						<UButton
							class="absolute top-1.5 right-1 opacity-0 group-hover:opacity-100"
							color="neutral"
							icon="i-lucide-ellipsis"
							size="xs"
							variant="ghost"
						/>
					</UDropdownMenu>
					<div
						v-for="participant in rooms[channel.id] ?? []"
						:key="participant.memberId"
						class="ml-4 flex items-center gap-2 py-0.5 pl-2"
					>
						<UAvatar
							:alt="participantName(participant)"
							:class="isSpeaking(channel.id, participant) ? 'ring-success ring-2' : ''"
							:src="membersStore.profile(participant.memberId)?.avatarUrl ?? undefined"
							size="3xs"
						/>
						<span class="text-muted truncate text-xs">{{ participantName(participant) }}</span>
						<UIcon
							v-if="isMuted(participant)"
							class="text-dimmed size-3 shrink-0"
							name="i-lucide-mic-off"
						/>
						<UIcon
							v-if="isCameraOn(participant)"
							class="text-primary size-3 shrink-0"
							name="i-lucide-video"
						/>
						<UIcon
							v-if="participant.screenSharing"
							class="text-primary size-3 shrink-0"
							name="i-lucide-monitor-up"
						/>
					</div>
				</div>
			</div>
		</div>
	</nav>
</template>

<script lang="ts" setup>
import type { DropdownMenuItem } from '@nuxt/ui'

import ChannelFormModal from './ChannelFormModal.vue'
import ConfirmModal from './ConfirmModal.vue'

const store = useChannelsStore()
const membersStore = useMembersStore()
const voice = useVoice()
const { voice: rooms } = useRealtime()
const { user } = useUserSession()
const toast = useToast()

const overlay = useOverlay()
const channelModal = overlay.create(ChannelFormModal)
const confirmModal = overlay.create(ConfirmModal)

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

function channelMenu(channel: ChannelDto): DropdownMenuItem[][] {
	return [
		[
			{
				label: 'Переименовать',
				icon: 'i-lucide-pencil',
				onSelect: () => {
					channelModal.open({ channel })
				}
			}
		],
		[
			{
				label: 'Удалить',
				icon: 'i-lucide-trash-2',
				color: 'error',
				onSelect: () => deleteChannel(channel)
			}
		]
	]
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
