<template>
	<div class="flex flex-col gap-6">
		<section v-for="(entry, index) in changelog" :key="entry.version" class="flex flex-col gap-2">
			<div class="flex items-baseline gap-2">
				<h3 class="text-highlighted font-semibold">
					{{ entry.title ?? `Версия ${entry.version}` }}
				</h3>
				<UBadge v-if="index === 0" color="primary" label="Новое" size="sm" variant="subtle" />
			</div>
			<p class="text-dimmed text-xs">Версия {{ entry.version }} · {{ formatDate(entry.date) }}</p>
			<ul class="text-muted flex list-disc flex-col gap-1 ps-5 text-sm">
				<li v-for="(change, i) in entry.changes" :key="i">{{ change }}</li>
			</ul>
		</section>
	</div>
</template>

<script lang="ts" setup>
const { changelog } = useChangelog()
</script>
