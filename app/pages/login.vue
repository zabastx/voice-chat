<template>
	<div class="flex min-h-dvh items-center justify-center p-4">
		<UPageCard class="w-full max-w-md">
			<UAuthForm
				:fields="fields"
				:schema="schema"
				:submit="{ label: 'Войти', block: true }"
				description="Войдите в свой аккаунт."
				icon="i-lucide-headphones"
				title="С возвращением!"
				@submit="onSubmit"
			>
				<template #validation>
					<UAlert v-if="error" :title="error" color="error" icon="i-lucide-circle-alert" />
				</template>
				<template #footer> Нет аккаунта? Попросите у админа ссылку-приглашение. </template>
			</UAuthForm>
		</UPageCard>
	</div>
</template>

<script lang="ts" setup>
import type { AuthFormField, FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

definePageMeta({ layout: false })

const fields: AuthFormField[] = [
	{
		name: 'username',
		type: 'text',
		label: 'Имя пользователя',
		placeholder: 'Ваше имя пользователя',
		required: true
	},
	{
		name: 'password',
		type: 'password',
		label: 'Пароль',
		placeholder: 'Ваш пароль',
		required: true
	}
]

const schema = z.object({
	username: z.string().min(1, 'Введите имя пользователя'),
	password: z.string().min(1, 'Введите пароль')
})

type Schema = z.output<typeof schema>

const { fetch: refreshSession } = useUserSession()
const error = ref('')

async function onSubmit(event: FormSubmitEvent<Schema>) {
	error.value = ''
	try {
		await $fetch('/api/auth/login', { method: 'POST', body: event.data })
		await refreshSession()
		await navigateTo('/')
	} catch (e) {
		error.value = (e as { data?: { message?: string } }).data?.message ?? 'Не удалось войти'
	}
}
</script>
