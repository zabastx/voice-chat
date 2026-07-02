<template>
	<UModal
		:close="{ onClick: () => emit('close', false) }"
		:title="channel ? `Переименовать #${channel.name}` : 'Новый канал'"
		:ui="{ footer: 'justify-end' }"
	>
		<template #body>
			<UForm id="channel-form" :schema="schema" :state="state" class="space-y-4" @submit="onSubmit">
				<UFormField label="Название" name="name">
					<UInput v-model="state.name" autofocus class="w-full" placeholder="название-канала" />
				</UFormField>
				<UFormField v-if="!channel" label="Тип" name="kind">
					<URadioGroup
						v-model="state.kind"
						:items="[
							{ label: 'Текстовый — сообщения и файлы', value: 'text' },
							{ label: 'Голосовой — разговоры и демонстрация экрана', value: 'voice' }
						]"
					/>
				</UFormField>
			</UForm>
		</template>
		<template #footer>
			<UButton color="neutral" label="Отмена" variant="outline" @click="emit('close', false)" />
			<UButton
				:label="channel ? 'Сохранить' : 'Создать'"
				:loading="saving"
				form="channel-form"
				type="submit"
			/>
		</template>
	</UModal>
</template>

<script lang="ts" setup>
import type { FormSubmitEvent } from '@nuxt/ui'
import * as z from 'zod'

const props = defineProps<{
	channel?: ChannelDto
	defaultKind?: 'text' | 'voice'
}>()

const emit = defineEmits<{ close: [boolean] }>()

const schema = z.object({
	name: channelNameSchema,
	kind: z.enum(['text', 'voice'])
})

type Schema = z.output<typeof schema>

const state = reactive<Partial<Schema>>({
	name: props.channel?.name ?? '',
	kind: props.channel?.kind ?? props.defaultKind ?? 'text'
})

const saving = ref(false)
const toast = useToast()

async function onSubmit(event: FormSubmitEvent<Schema>) {
	saving.value = true
	try {
		if (props.channel) {
			await $fetch(`/api/channels/${props.channel.id}`, {
				method: 'PATCH',
				body: { name: event.data.name }
			})
		} else {
			await $fetch('/api/channels', { method: 'POST', body: event.data })
		}
		emit('close', true)
	} catch (e) {
		toast.add({
			title: (e as { data?: { message?: string } }).data?.message ?? 'Не удалось сохранить канал',
			color: 'error'
		})
	} finally {
		saving.value = false
	}
}
</script>
