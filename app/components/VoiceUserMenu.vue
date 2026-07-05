<template>
	<UContextMenu :disabled="disabled" :items="items">
		<slot />
		<template #content-top>
			<div class="flex flex-col gap-1.5 px-2 py-1.5">
				<div class="text-muted flex items-center justify-between text-xs">
					<span>Громкость</span>
					<span class="tabular-nums">{{ voice.localVolume(identity) }}%</span>
				</div>
				<USlider
					:max="200"
					:min="0"
					:model-value="voice.localVolume(identity)"
					:step="1"
					@update:model-value="onVolume"
				/>
			</div>
		</template>
	</UContextMenu>
</template>

<script lang="ts" setup>
import type { ContextMenuItem } from '@nuxt/ui'

// Discord-style right-click menu for a voice participant: a local volume slider
// plus a local-mute toggle. Purely client-side (see ADR 0003). `identity` is the
// speaker's member id; `disabled` falls back to the native context menu (used for
// your own row and channels you are not connected to).
const props = defineProps<{ identity: string; disabled?: boolean }>()

const voice = useVoice()
const dm = useDmStore()
const { user } = useUserSession()
const toast = useToast()

const items = computed<ContextMenuItem[][]>(() => {
	const groups: ContextMenuItem[][] = []
	if (props.identity !== user.value?.id) {
		groups.push([{ label: 'Написать', icon: 'i-lucide-message-square', onSelect: openDm }])
	}
	groups.push([
		voice.isLocallyMuted(props.identity)
			? {
					label: 'Включить звук',
					icon: 'i-lucide-volume-2',
					onSelect: () => voice.toggleLocalMute(props.identity)
				}
			: {
					label: 'Заглушить',
					icon: 'i-lucide-volume-x',
					onSelect: () => voice.toggleLocalMute(props.identity)
				}
	])
	return groups
})

async function openDm() {
	try {
		await dm.openDm(props.identity)
	} catch {
		toast.add({ title: 'Не удалось открыть диалог', color: 'error' })
	}
}

function onVolume(value: number | undefined) {
	if (typeof value === 'number') voice.setLocalVolume(props.identity, value)
}
</script>
