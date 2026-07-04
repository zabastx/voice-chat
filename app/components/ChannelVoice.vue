<template>
	<UDashboardPanel
		id="voice"
		:ui="{ root: 'h-svh min-h-0', body: 'min-h-0 gap-0 p-0 sm:gap-0 sm:p-0' }"
	>
		<template #header>
			<UDashboardNavbar
				:title="channel ? channel.name : ''"
				icon="i-lucide-volume-2"
				:toggle="false"
			>
				<template #leading>
					<SidebarToggle />
				</template>
				<template #right>
					<MembersToggle />
				</template>
			</UDashboardNavbar>
		</template>

		<template #body>
			<div class="bg-elevated/30 flex min-h-0 flex-1 flex-col">
				<!-- focus mode: one enlarged tile (optionally fullscreen) -->
				<div
					v-if="focused && focusedTile"
					ref="focusedEl"
					class="bg-elevated/30 relative flex min-h-0 flex-1 cursor-pointer flex-col"
					:class="isFullscreen ? 'p-0' : 'p-3'"
					@click="focused = null"
				>
					<VoiceTile v-bind="focusedTile" />
					<UTooltip :text="isFullscreen ? 'Выйти из полноэкранного режима' : 'Во весь экран'">
						<UButton
							:icon="isFullscreen ? 'i-lucide-minimize' : 'i-lucide-maximize'"
							class="absolute end-5 top-5"
							color="neutral"
							size="sm"
							variant="solid"
							@click.stop="toggleFullscreen"
						/>
					</UTooltip>
				</div>

				<!-- fixed-size tiles, wrapped and centered over the whole view -->
				<div
					v-else-if="tiles.length"
					class="flex min-h-0 flex-1 flex-wrap content-center-safe justify-center-safe gap-3 overflow-y-auto p-3"
				>
					<VoiceUserMenu
						v-for="tile in tiles"
						:key="tile.key"
						:disabled="!canAdjust(tile)"
						:identity="tile.memberId ?? ''"
					>
						<div class="h-45 w-80 max-w-full shrink-0 cursor-pointer" @click="focused = tile.key">
							<VoiceTile v-bind="tile.props" />
						</div>
					</VoiceUserMenu>
				</div>

				<!-- empty channel -->
				<div
					v-else
					class="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center"
				>
					<UIcon class="text-dimmed size-10" name="i-lucide-volume-2" />
					<p class="text-muted text-sm">В канале пока никого нет.</p>
				</div>

				<!-- control bar -->
				<div class="border-default flex shrink-0 items-center justify-center gap-2 border-t p-3">
					<template v-if="connectedHere">
						<UTooltip :text="voice.muted.value ? 'Включить микрофон' : 'Выключить микрофон'">
							<UButton
								:color="voice.muted.value ? 'error' : 'neutral'"
								:icon="voice.muted.value ? 'i-lucide-mic-off' : 'i-lucide-mic'"
								size="lg"
								variant="soft"
								@click="voice.toggleMute"
							/>
						</UTooltip>
						<UTooltip :text="voice.camera.value ? 'Выключить камеру' : 'Включить камеру'">
							<UButton
								:color="voice.camera.value ? 'primary' : 'neutral'"
								:icon="voice.camera.value ? 'i-lucide-video' : 'i-lucide-video-off'"
								size="lg"
								variant="soft"
								@click="voice.toggleCamera"
							/>
						</UTooltip>
						<UTooltip :text="voice.sharing.value ? 'Остановить показ' : 'Демонстрация экрана'">
							<UButton
								:color="voice.sharing.value ? 'primary' : 'neutral'"
								icon="i-lucide-monitor-up"
								size="lg"
								variant="soft"
								@click="voice.toggleScreenShare"
							/>
						</UTooltip>
						<UTooltip text="Отключиться">
							<UButton
								color="error"
								icon="i-lucide-phone-off"
								size="lg"
								variant="soft"
								@click="voice.leave"
							/>
						</UTooltip>
					</template>
					<UButton
						v-else
						:loading="voice.connecting.value"
						color="success"
						icon="i-lucide-phone"
						label="Подключиться"
						size="lg"
						@click="() => voice.join(channelId)"
					/>
				</div>
			</div>
		</template>
	</UDashboardPanel>
</template>

<script lang="ts" setup>
const route = useRoute()
const voice = useVoice()
const { voice: rooms } = useRealtime()
const membersStore = useMembersStore()
const store = useChannelsStore()
const { user } = useUserSession()

const focused = ref<string | null>(null)
const focusedEl = ref<HTMLElement>()
const isFullscreen = ref(false)

const channelId = computed(() => route.params.id as string)
const channel = computed(() => store.channels.value.find((c) => c.id === channelId.value))
const connectedHere = computed(() => voice.currentChannelId.value === channelId.value)
const roster = computed(() => rooms.value[channelId.value] ?? [])

function isSpeaking(p: VoiceParticipant) {
	return p.speaking || (connectedHere.value && voice.speakingIds.value.includes(p.memberId))
}

function isMuted(p: VoiceParticipant) {
	return p.memberId === user.value?.id && connectedHere.value ? voice.muted.value : p.muted
}

function participantName(p: VoiceParticipant) {
	return membersStore.profile(p.memberId)?.displayName ?? p.username
}

const tiles = computed(() => {
	// referencing cameraTiles keeps this reactive as camera tracks (un)subscribe
	const camIds = new Set(voice.cameraTiles.value.map((t) => t.identity))
	const list = roster.value.map((p) => ({
		key: `p:${p.memberId}`,
		memberId: p.memberId as string | undefined,
		props: {
			track:
				connectedHere.value && camIds.has(p.memberId)
					? voice.cameraTrackFor(p.memberId)
					: undefined,
			label: participantName(p),
			avatarUrl: membersStore.profile(p.memberId)?.avatarUrl,
			muted: isMuted(p),
			speaking: isSpeaking(p),
			locallyMuted:
				connectedHere.value && p.memberId !== user.value?.id && voice.isLocallyMuted(p.memberId)
		}
	}))
	if (connectedHere.value) {
		for (const s of voice.screenShares.value) {
			list.push({
				key: `s:${s.sid}`,
				memberId: undefined,
				props: {
					track: voice.screenTrackFor(s.sid),
					label: `${s.name} — экран`,
					avatarUrl: undefined,
					muted: false,
					speaking: false,
					locallyMuted: false,
					icon: 'i-lucide-monitor-up'
				} as (typeof list)[number]['props']
			})
		}
	}
	return list
})

const focusedTile = computed(() => tiles.value.find((t) => t.key === focused.value)?.props)

// local volume/mute only applies to other participants while we are in the call
function canAdjust(tile: (typeof tiles.value)[number]) {
	return connectedHere.value && !!tile.memberId && tile.memberId !== user.value?.id
}

// drop focus if the focused tile disappears (owner left / stopped video);
// removing the element from the DOM also exits fullscreen automatically
watch(focusedTile, (tile) => {
	if (!tile) focused.value = null
})

async function toggleFullscreen() {
	if (document.fullscreenElement) {
		await document.exitFullscreen()
	} else {
		await focusedEl.value?.requestFullscreen?.()
	}
}

function onFullscreenChange() {
	isFullscreen.value = !!document.fullscreenElement
}

function onKeyDown(e: KeyboardEvent) {
	// while fullscreen, let the browser handle Escape (it exits fullscreen); only
	// leave focus mode with Escape once we're back in the normal layout
	if (e.key === 'Escape' && focused.value && !isFullscreen.value) focused.value = null
}

onMounted(() => {
	window.addEventListener('keydown', onKeyDown)
	document.addEventListener('fullscreenchange', onFullscreenChange)
})
onUnmounted(() => {
	window.removeEventListener('keydown', onKeyDown)
	document.removeEventListener('fullscreenchange', onFullscreenChange)
})
</script>
