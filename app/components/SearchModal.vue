<template>
	<UModal
		:close="{ onClick: () => emit('close') }"
		:ui="{ content: 'max-w-xl' }"
		title="Поиск сообщений"
	>
		<template #body>
			<UInput
				v-model="query"
				autofocus
				class="w-full"
				icon="i-lucide-search"
				placeholder="Искать в сообщениях…"
				size="lg"
			/>

			<div class="mt-3 max-h-[60vh] min-h-24 overflow-y-auto">
				<div v-if="loading" class="flex justify-center py-6">
					<UIcon class="text-muted size-5 animate-spin" name="i-lucide-loader-2" />
				</div>
				<p v-else-if="query.trim() && !results.length" class="text-muted py-6 text-center text-sm">
					Ничего не найдено
				</p>
				<p v-else-if="!query.trim()" class="text-dimmed py-6 text-center text-sm">
					Введите запрос, чтобы найти сообщения
				</p>
				<div v-else class="flex flex-col gap-4">
					<div v-for="group in grouped" :key="group.channelId">
						<p class="text-dimmed mb-1 px-1 text-xs font-semibold">#{{ group.channelName }}</p>
						<button
							v-for="result in group.items"
							:key="result.messageId"
							class="hover:bg-elevated flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left"
							type="button"
							@click="go(result)"
						>
							<div class="flex items-center gap-2 text-xs">
								<span class="text-highlighted font-medium">{{ result.authorName }}</span>
								<span class="text-dimmed">{{ formatTimestamp(result.createdAt) }}</span>
							</div>
							<!-- eslint-disable-next-line vue/no-v-html -- escaped in highlight() -->
							<p
								class="text-default line-clamp-2 text-sm break-words"
								v-html="highlight(result.preview)"
							/>
						</button>
					</div>
				</div>
			</div>
		</template>
	</UModal>
</template>

<script lang="ts" setup>
const emit = defineEmits<{ close: [] }>()

const query = ref('')
const results = ref<SearchResultDto[]>([])
const loading = ref(false)
const jump = useMessageJump()

const terms = computed(() => query.value.match(/[\p{L}\p{N}]+/gu) ?? [])

let timer: ReturnType<typeof setTimeout> | undefined
watch(query, () => {
	clearTimeout(timer)
	const q = query.value.trim()
	if (!q) {
		results.value = []
		loading.value = false
		return
	}
	loading.value = true
	timer = setTimeout(async () => {
		try {
			const res = await $fetch('/api/search', { query: { q } })
			// ignore stale responses if the query moved on
			if (query.value.trim() === q) results.value = res.results
		} catch {
			results.value = []
		} finally {
			if (query.value.trim() === q) loading.value = false
		}
	}, 250)
})

const grouped = computed(() => {
	const map = new Map<
		string,
		{ channelId: string; channelName: string; items: SearchResultDto[] }
	>()
	for (const result of results.value) {
		let group = map.get(result.channelId)
		if (!group) {
			group = { channelId: result.channelId, channelName: result.channelName, items: [] }
			map.set(result.channelId, group)
		}
		group.items.push(result)
	}
	return [...map.values()]
})

function escapeHtml(value: string): string {
	const map: Record<string, string> = {
		'&': '&amp;',
		'<': '&lt;',
		'>': '&gt;',
		'"': '&quot;',
		"'": '&#39;'
	}
	return value.replace(/[&<>"']/g, (c) => map[c]!)
}

// escape first, then wrap query terms in a static <mark> — safe for v-html
function highlight(text: string): string {
	const escaped = escapeHtml(text)
	if (terms.value.length === 0) return escaped
	const pattern = terms.value.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
	return escaped.replace(new RegExp(`(${pattern})`, 'giu'), '<mark>$1</mark>')
}

function go(result: SearchResultDto) {
	jump.value = { channelId: result.channelId, messageId: result.messageId }
	emit('close')
	void navigateTo(`/channels/${result.channelId}`)
}
</script>
