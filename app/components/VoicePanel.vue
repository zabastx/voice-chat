<template>
	<div v-if="voice.currentChannelId.value || voice.connecting.value" class="w-full space-y-2">
		<div class="flex items-center gap-2">
			<UIcon
				:class="voice.connecting.value ? 'text-warning animate-pulse' : 'text-success'"
				class="size-4 shrink-0"
				name="i-lucide-audio-lines"
			/>
			<div class="min-w-0 flex-1">
				<p
					:class="voice.connecting.value ? 'text-warning' : 'text-success'"
					class="text-xs font-semibold"
				>
					{{ voice.connecting.value ? 'Подключение…' : 'Голос подключён' }}
				</p>
				<p class="text-muted truncate text-xs">{{ channelName }}</p>
			</div>
		</div>
		<div class="flex gap-1">
			<UTooltip
				:text="voice.muted.value ? 'Включить микрофон' : 'Выключить микрофон'"
				class="flex-1"
			>
				<UButton
					:color="voice.muted.value ? 'error' : 'neutral'"
					:icon="voice.muted.value ? 'i-lucide-mic-off' : 'i-lucide-mic'"
					block
					size="sm"
					variant="soft"
					@click="voice.toggleMute"
				/>
			</UTooltip>
			<UTooltip
				:text="voice.sharing.value ? 'Остановить показ' : 'Демонстрация экрана'"
				class="flex-1"
			>
				<UButton
					:color="voice.sharing.value ? 'primary' : 'neutral'"
					block
					icon="i-lucide-monitor-up"
					size="sm"
					variant="soft"
					@click="voice.toggleScreenShare"
				/>
			</UTooltip>
			<UTooltip class="flex-1" text="Отключиться">
				<UButton
					block
					color="error"
					icon="i-lucide-phone-off"
					size="sm"
					variant="soft"
					@click="voice.leave"
				/>
			</UTooltip>
		</div>
	</div>
</template>

<script lang="ts" setup>
const voice = useVoice()
const store = useChannelsStore()

const channelName = computed(() => {
	const channel = store.channels.value.find((c) => c.id === voice.currentChannelId.value)
	return channel ? channel.name : ''
})
</script>
