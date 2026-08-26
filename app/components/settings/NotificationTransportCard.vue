<template>
	<!-- hides itself, separator included, when this messenger is not configured -->
	<div v-if="status.configured" class="space-y-8">
		<USeparator />
		<section class="space-y-4">
			<div>
				<h3 class="text-highlighted flex items-center gap-2 font-medium">
					{{ status.label }}
					<UBadge v-if="status.linked" color="success" variant="subtle">Подключено</UBadge>
				</h3>
				<p class="text-muted mt-1 text-sm">
					Получайте личные сообщения и упоминания в {{ status.label }}, когда вы не в сети. Ответьте
					на уведомление прямо в {{ status.label }} — сообщение отправится в чат.
				</p>
			</div>

			<template v-if="status.linked">
				<USwitch
					:description="`Присылать уведомления в ${status.label}.`"
					:label="`Уведомления в ${status.label}`"
					:model-value="status.notificationsEnabled"
					@update:model-value="onToggle"
				/>
				<UButton
					color="error"
					icon="i-lucide-unlink"
					:label="`Отключить ${status.label}`"
					variant="ghost"
					@click="disconnect"
				/>
			</template>

			<template v-else>
				<UButton
					:icon="status.icon"
					:label="`Подключить ${status.label}`"
					:loading="linking"
					variant="soft"
					@click="connect"
				/>
				<UAlert
					v-if="awaiting"
					color="info"
					icon="i-lucide-info"
					title="Почти готово"
					variant="subtle"
				>
					<template #description>
						{{ hint }}
						<UButton class="px-1" label="обновите статус" size="xs" variant="link" @click="load" />.
					</template>
				</UAlert>
			</template>
		</section>
	</div>
</template>

<script lang="ts" setup>
const props = defineProps<{ transport: NotificationTransport }>()

const toast = useToast()

interface TransportStatus {
	transport: string
	label: string
	icon: string
	configured: boolean
	linked: boolean
	notificationsEnabled: boolean
}

// label and icon come from the server with the status — the client should not
// hold a second copy of what each messenger is called (adr/0011).
const status = reactive<TransportStatus>({
	transport: props.transport,
	label: '',
	icon: '',
	configured: false,
	linked: false,
	notificationsEnabled: true
})
const linking = ref(false)
const awaiting = ref(false)

const base = computed(() => `/api/me/notifications/${props.transport}`)
// each messenger's "you're not done yet" step differs: Telegram shows a Start
// button in the bot chat, VK shows «Начать» in the community dialog
const hint = computed(() =>
	props.transport === 'vk'
		? 'Откройте диалог с сообществом и нажмите «Начать». Затем'
		: 'Откройте бота в Telegram и нажмите «Start». Затем'
)

function errorMessage(e: unknown, fallback: string) {
	return (e as { data?: { message?: string } }).data?.message ?? fallback
}

async function load() {
	try {
		Object.assign(status, await $fetch<TransportStatus>(base.value))
		if (status.linked) awaiting.value = false
	} catch (e) {
		toast.add({ title: errorMessage(e, 'Не удалось загрузить настройки'), color: 'error' })
	}
}
onMounted(load)

async function connect() {
	// Open the tab synchronously on the click so it stays user-activated: opening
	// after the awaited fetch gets blocked as a non-user-initiated popup.
	const win = window.open('', '_blank')
	linking.value = true
	try {
		const { url } = await $fetch<{ url: string }>(`${base.value}/link-token`, { method: 'POST' })
		if (win) {
			win.opener = null
			win.location.href = url
		} else {
			// popup was blocked entirely — fall back to same-tab navigation
			window.location.href = url
		}
		awaiting.value = true
	} catch (e) {
		win?.close()
		toast.add({ title: errorMessage(e, `Не удалось подключить ${status.label}`), color: 'error' })
	} finally {
		linking.value = false
	}
}

async function onToggle(enabled: boolean) {
	const prev = status.notificationsEnabled
	status.notificationsEnabled = enabled
	try {
		await $fetch(base.value, { method: 'PATCH', body: { notificationsEnabled: enabled } })
	} catch (e) {
		status.notificationsEnabled = prev
		toast.add({ title: errorMessage(e, 'Не удалось сохранить настройку'), color: 'error' })
	}
}

async function disconnect() {
	try {
		await $fetch(`${base.value}/unlink`, { method: 'POST' })
		status.linked = false
		awaiting.value = false
	} catch (e) {
		toast.add({ title: errorMessage(e, `Не удалось отключить ${status.label}`), color: 'error' })
	}
}
</script>
