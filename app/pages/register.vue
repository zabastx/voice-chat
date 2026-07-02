<template>
	<div class="flex min-h-dvh items-center justify-center p-4">
		<UPageCard class="w-full max-w-md">
			<UAlert
				v-if="!canRegister"
				color="warning"
				description="Ссылка-приглашение недействительна или уже использована. Попросите у админа новую."
				icon="i-lucide-ticket-x"
				title="Нужно приглашение"
			/>
			<UAuthForm
				v-else
				:description="
					setup?.needsSetup
						? 'Вы здесь первый — этот аккаунт станет админским.'
						: 'Придумайте имя пользователя и пароль.'
				"
				:fields="fields"
				:schema="schema"
				:submit="{ label: 'Создать аккаунт', block: true }"
				:title="setup?.needsSetup ? 'Создание аккаунта админа' : 'Присоединяйтесь!'"
				icon="i-lucide-user-plus"
				@submit="onSubmit"
			>
				<template #validation>
					<UAlert v-if="error" :title="error" color="error" icon="i-lucide-circle-alert" />
				</template>
				<template #footer>
					Уже есть аккаунт?
					<ULink class="text-primary font-medium" to="/login">Войти</ULink>
				</template>
			</UAuthForm>
		</UPageCard>
	</div>
</template>

<script lang="ts" setup>
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

definePageMeta({ layout: false })

const route = useRoute()
const invite = computed(() => (route.query.invite as string | undefined) ?? undefined)

const { data: setup } = await useFetch('/api/auth/setup')
const { data: inviteCheck } = await useFetch(() => `/api/invites/${invite.value}`, {
	immediate: Boolean(invite.value)
})

const canRegister = computed(
	() => setup.value?.needsSetup || (invite.value && inviteCheck.value?.valid)
)

const fields: AuthFormField[] = [
	{
		name: 'username',
		type: 'text',
		label: 'Имя пользователя',
		placeholder: 'Придумайте имя',
		required: true
	},
	{
		name: 'password',
		type: 'password',
		label: 'Пароль',
		placeholder: 'Минимум 8 символов',
		required: true
	}
]

const schema = z.object({
	username: usernameSchema,
	password: passwordSchema
})

type Schema = z.output<typeof schema>

const { fetch: refreshSession } = useUserSession()
const error = ref('')

async function onSubmit(event: FormSubmitEvent<Schema>) {
	error.value = ''
	try {
		await $fetch('/api/auth/register', {
			method: 'POST',
			body: { ...event.data, invite: invite.value }
		})
		await refreshSession()
		await navigateTo('/')
	} catch (e) {
		error.value =
			(e as { data?: { message?: string } }).data?.message ?? 'Не удалось зарегистрироваться'
	}
}
</script>
