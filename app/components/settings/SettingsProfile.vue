<template>
	<div class="space-y-8">
		<h2 class="text-highlighted text-lg font-semibold">Профиль</h2>

		<section class="flex items-center gap-4">
			<UAvatar :alt="displayName" :src="self?.avatarUrl ?? undefined" size="3xl" />
			<div class="flex flex-wrap gap-2">
				<UButton
					:loading="uploading"
					icon="i-lucide-image-up"
					label="Загрузить аватар"
					variant="soft"
					@click="fileInput?.click()"
				/>
				<UButton
					v-if="self?.avatarUrl"
					color="error"
					label="Удалить аватар"
					variant="ghost"
					@click="removeAvatar"
				/>
				<input
					ref="fileInput"
					accept="image/png,image/jpeg,image/webp,image/gif"
					class="hidden"
					type="file"
					@change="uploadAvatar"
				/>
			</div>
		</section>

		<USeparator />

		<UForm :schema="nameSchema" :state="nameState" class="space-y-4" @submit="saveName">
			<UFormField
				description="Как вас будут видеть другие. Оставьте пустым, чтобы использовать логин."
				label="Отображаемое имя"
				name="displayName"
			>
				<UInput
					v-model="nameState.displayName"
					:placeholder="user?.username"
					class="w-full max-w-xs"
				/>
			</UFormField>
			<UButton :loading="savingName" label="Сохранить" type="submit" />
		</UForm>

		<USeparator />

		<UForm
			:schema="passwordFormSchema"
			:state="passwordState"
			class="space-y-4"
			@submit="savePassword"
		>
			<h3 class="text-highlighted font-medium">Смена пароля</h3>
			<UFormField label="Текущий пароль" name="currentPassword">
				<UInput v-model="passwordState.currentPassword" class="w-full max-w-xs" type="password" />
			</UFormField>
			<UFormField label="Новый пароль" name="newPassword">
				<UInput v-model="passwordState.newPassword" class="w-full max-w-xs" type="password" />
			</UFormField>
			<UFormField label="Повторите новый пароль" name="repeatPassword">
				<UInput v-model="passwordState.repeatPassword" class="w-full max-w-xs" type="password" />
			</UFormField>
			<UButton :loading="savingPassword" label="Изменить пароль" type="submit" />
		</UForm>

		<USeparator />

		<div class="space-y-3">
			<h3 class="text-highlighted font-medium">Сеансы</h3>
			<p class="text-muted text-sm">
				Завершает вход на всех устройствах, включая это — войти нужно будет заново.
			</p>
			<UButton
				:loading="signingOutAll"
				color="error"
				label="Выйти со всех устройств"
				variant="subtle"
				@click="signOutAll"
			/>
		</div>
	</div>
</template>

<script lang="ts" setup>
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

import ConfirmModal from '../ConfirmModal.vue'

const toast = useToast()
const { user, clear: clearSession } = useUserSession()
const membersStore = useMembersStore()

const self = computed(() => membersStore.profile(user.value?.id))
const displayName = computed(() => self.value?.displayName ?? user.value?.username)

function errorMessage(e: unknown, fallback: string) {
	return (e as { data?: { message?: string } }).data?.message ?? fallback
}

// avatar
const MAX_AVATAR_SIZE = 5 * 1024 * 1024

const fileInput = ref<HTMLInputElement>()
const uploading = ref(false)

async function uploadAvatar(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	if (file.size > MAX_AVATAR_SIZE) {
		toast.add({ title: 'Файл слишком большой (максимум 5 МБ)', color: 'error' })
		return
	}
	uploading.value = true
	try {
		const form = new FormData()
		form.append('file', file)
		const member = await $fetch('/api/me/avatar', { method: 'POST', body: form })
		membersStore.apply({ type: 'member.updated', member })
	} catch (e) {
		toast.add({ title: errorMessage(e, 'Не удалось загрузить аватар'), color: 'error' })
	} finally {
		uploading.value = false
	}
}

async function removeAvatar() {
	try {
		const member = await $fetch('/api/me/avatar', { method: 'DELETE' })
		membersStore.apply({ type: 'member.updated', member })
	} catch (e) {
		toast.add({ title: errorMessage(e, 'Не удалось удалить аватар'), color: 'error' })
	}
}

// display name
const nameSchema = z.object({
	displayName: z.string().trim().max(32, 'Не длиннее 32 символов')
})

const nameState = reactive({ displayName: self.value?.displayName ?? '' })
const savingName = ref(false)

async function saveName(event: FormSubmitEvent<z.output<typeof nameSchema>>) {
	savingName.value = true
	try {
		const member = await $fetch('/api/me/profile', {
			method: 'PATCH',
			body: { displayName: event.data.displayName || null }
		})
		membersStore.apply({ type: 'member.updated', member })
		toast.add({ title: 'Профиль обновлён', color: 'success' })
	} catch (e) {
		toast.add({ title: errorMessage(e, 'Не удалось сохранить профиль'), color: 'error' })
	} finally {
		savingName.value = false
	}
}

// password
const passwordFormSchema = z
	.object({
		currentPassword: z.string().min(1, 'Введите текущий пароль'),
		newPassword: passwordSchema,
		repeatPassword: z.string()
	})
	.refine((data) => data.newPassword === data.repeatPassword, {
		message: 'Пароли не совпадают',
		path: ['repeatPassword']
	})

const passwordState = reactive({ currentPassword: '', newPassword: '', repeatPassword: '' })
const savingPassword = ref(false)

async function savePassword(event: FormSubmitEvent<z.output<typeof passwordFormSchema>>) {
	savingPassword.value = true
	try {
		await $fetch('/api/me/password', {
			method: 'POST',
			body: {
				currentPassword: event.data.currentPassword,
				newPassword: event.data.newPassword
			}
		})
		passwordState.currentPassword = ''
		passwordState.newPassword = ''
		passwordState.repeatPassword = ''
		toast.add({ title: 'Пароль изменён', color: 'success' })
	} catch (e) {
		toast.add({ title: errorMessage(e, 'Не удалось изменить пароль'), color: 'error' })
	} finally {
		savingPassword.value = false
	}
}

// sessions
const { stop: stopRealtime } = useRealtime()
const overlay = useOverlay()
const confirmModal = overlay.create(ConfirmModal)
const signingOutAll = ref(false)

// Bumping the Sign-in Epoch takes this device with it, so there is nothing left
// to fetch afterwards — go straight to /login rather than letting the next
// request 401 into a blank screen.
async function signOutAll() {
	const instance = confirmModal.open({
		title: 'Выйти со всех устройств?',
		description: 'Все входы будут завершены, включая текущий. Войти нужно будет заново.',
		confirmLabel: 'Выйти везде'
	})
	if (!(await instance.result)) return
	signingOutAll.value = true
	try {
		await $fetch('/api/me/sign-out-all', { method: 'POST' })
		// mirror SelfPanel's logout: drop the socket and the client-side session
		// state before navigating. Without `clear()` the client still believes it
		// is signed in, and the global auth middleware bounces /login back to the
		// app — the cookie is gone, so every request then 401s on a live-looking UI.
		stopRealtime()
		await clearSession()
		await navigateTo('/login')
	} catch {
		toast.add({ title: 'Не удалось выйти', color: 'error' })
	} finally {
		signingOutAll.value = false
	}
}
</script>
