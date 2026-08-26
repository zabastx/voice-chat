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
				:model-value="prefs.desktopNotifications"
				description="Показывать уведомление, когда окно не в фокусе."
				label="Уведомления на рабочем столе"
				@update:model-value="onDesktopToggle"
			/>

			<UAlert
				v-if="blocked"
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

const blocked = ref(
	import.meta.client && 'Notification' in window && Notification.permission === 'denied'
)

async function onDesktopToggle(enabled: boolean) {
	if (!enabled) {
		prefs.value.desktopNotifications = false
		return
	}
	if (!('Notification' in window)) {
		toast.add({ title: 'Браузер не поддерживает уведомления', color: 'warning' })
		return
	}
	const permission = await Notification.requestPermission()
	blocked.value = permission === 'denied'
	if (permission !== 'granted') return
	prefs.value.desktopNotifications = true
}

// Each card loads its own status and hides itself when its messenger is not
// configured, so this screen needs no per-transport knowledge (adr/0011).
const transports = NOTIFICATION_TRANSPORTS
</script>
