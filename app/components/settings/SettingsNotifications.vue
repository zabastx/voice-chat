<template>
	<div class="space-y-8">
		<h2 class="text-highlighted text-lg font-semibold">Уведомления</h2>

		<section class="space-y-6">
			<USwitch
				v-model="prefs.messageSound"
				description="Короткий сигнал, когда приходит сообщение в неактивный канал."
				label="Звук при новом сообщении"
			/>

			<USwitch
				:description="desktopDescription"
				:disabled="notifications.unsupported.value"
				:model-value="prefs.desktopNotifications"
				label="Уведомления на рабочем столе"
				@update:model-value="onDesktopToggle"
			/>

			<UAlert
				v-if="notifications.blocked.value"
				color="warning"
				description="Разрешите уведомления для этого сайта в настройках браузера."
				icon="i-lucide-bell-off"
				title="Уведомления заблокированы"
				variant="subtle"
			/>
		</section>

		<SettingsNotificationTransportCard
			v-for="transport in transports"
			:key="transport"
			:transport="transport"
		/>
	</div>
</template>

<script lang="ts" setup>
import { NOTIFICATION_TRANSPORTS } from '~~/shared/utils/notification-transports'

const toast = useToast()
const prefs = usePreferences()
const notifications = useDesktopNotifications()

// A Desktop Client shows these itself, so there is no site permission to explain — and
// no «не в фокусе», since the window it is not in front of may be hidden in the tray.
const desktopDescription = computed(() =>
	notifications.transport.value === 'native'
		? 'Показывать уведомление, когда окно свёрнуто в трей или не в фокусе.'
		: 'Показывать уведомление, когда окно не в фокусе.'
)

async function onDesktopToggle(enabled: boolean) {
	if (!enabled) {
		notifications.disable()
		return
	}
	if (await notifications.enable()) return
	if (notifications.unsupported.value) {
		toast.add({ title: 'Браузер не поддерживает уведомления', color: 'warning' })
	}
	// A refusal is not a toast: the «Уведомления заблокированы» alert below says it, and
	// stays said, instead of appearing once and scrolling away.
}

// Each card loads its own status and hides itself when its messenger is not
// configured, so this screen needs no per-transport knowledge (adr/0011).
const transports = NOTIFICATION_TRANSPORTS
</script>
