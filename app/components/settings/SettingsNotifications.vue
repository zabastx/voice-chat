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

		<template v-if="tg.configured">
			<USeparator />

			<section class="space-y-4">
				<div>
					<h3 class="text-highlighted flex items-center gap-2 font-medium">
						Telegram
						<UBadge v-if="tg.linked" color="success" variant="subtle">Подключено</UBadge>
					</h3>
					<p class="text-muted mt-1 text-sm">
						Получайте личные сообщения и упоминания в Telegram, когда вы не в сети. Ответьте на
						уведомление прямо в Telegram — сообщение отправится в чат.
					</p>
				</div>

				<template v-if="tg.linked">
					<USwitch
						:model-value="tg.notificationsEnabled"
						description="Присылать уведомления в Telegram."
						label="Уведомления в Telegram"
						@update:model-value="onTelegramToggle"
					/>
					<UButton
						color="error"
						icon="i-lucide-unlink"
						label="Отключить Telegram"
						variant="ghost"
						@click="disconnect"
					/>
				</template>

				<template v-else>
					<UButton
						:loading="linking"
						icon="i-simple-icons-telegram"
						label="Подключить Telegram"
						variant="soft"
						@click="connect"
					/>
					<UAlert
						v-if="awaitingLink"
						color="info"
						icon="i-lucide-info"
						title="Почти готово"
						variant="subtle"
					>
						<template #description>
							Откройте бота в Telegram и нажмите «Start». Затем
							<UButton
								class="px-1"
								label="обновите статус"
								size="xs"
								variant="link"
								@click="load"
							/>.
						</template>
					</UAlert>
				</template>
			</section>
		</template>
	</div>
</template>

<script lang="ts" setup>
const toast = useToast()
const prefs = usePreferences()

const blocked = ref(
	import.meta.client && 'Notification' in window && Notification.permission === 'denied'
)

function errorMessage(e: unknown, fallback: string) {
	return (e as { data?: { message?: string } }).data?.message ?? fallback
}

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

// Telegram linking
interface TelegramStatus {
	configured: boolean
	linked: boolean
	notificationsEnabled: boolean
	botUsername: string | null
}
const tg = reactive<TelegramStatus>({
	configured: false,
	linked: false,
	notificationsEnabled: true,
	botUsername: null
})
const linking = ref(false)
const awaitingLink = ref(false)

async function load() {
	try {
		Object.assign(tg, await $fetch<TelegramStatus>('/api/me/telegram'))
		if (tg.linked) awaitingLink.value = false
	} catch (e) {
		toast.add({ title: errorMessage(e, 'Не удалось загрузить настройки Telegram'), color: 'error' })
	}
}
onMounted(load)

async function connect() {
	// Open the tab synchronously on the click so it stays user-activated: opening
	// after the awaited fetch gets blocked as a non-user-initiated popup.
	const win = window.open('', '_blank')
	linking.value = true
	try {
		const { token, botUsername } = await $fetch<{ token: string; botUsername: string }>(
			'/api/me/telegram/link-token',
			{ method: 'POST' }
		)
		const url = `https://t.me/${botUsername}?start=${token}`
		if (win) {
			win.opener = null
			win.location.href = url
		} else {
			// popup was blocked entirely — fall back to same-tab navigation
			window.location.href = url
		}
		awaitingLink.value = true
	} catch (e) {
		win?.close()
		toast.add({ title: errorMessage(e, 'Не удалось подключить Telegram'), color: 'error' })
	} finally {
		linking.value = false
	}
}

async function onTelegramToggle(enabled: boolean) {
	const prev = tg.notificationsEnabled
	tg.notificationsEnabled = enabled
	try {
		await $fetch<{ notificationsEnabled: boolean }>('/api/me/telegram', {
			method: 'PATCH',
			body: { notificationsEnabled: enabled }
		})
	} catch (e) {
		tg.notificationsEnabled = prev
		toast.add({ title: errorMessage(e, 'Не удалось сохранить настройку'), color: 'error' })
	}
}

async function disconnect() {
	try {
		await $fetch<{ ok: boolean }>('/api/me/telegram/unlink', { method: 'POST' })
		tg.linked = false
		awaitingLink.value = false
	} catch (e) {
		toast.add({ title: errorMessage(e, 'Не удалось отключить Telegram'), color: 'error' })
	}
}
</script>
