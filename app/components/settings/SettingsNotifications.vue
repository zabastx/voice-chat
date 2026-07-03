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
	</div>
</template>

<script lang="ts" setup>
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
</script>
