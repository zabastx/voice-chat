<template>
	<div class="space-y-8">
		<div class="flex items-baseline gap-2">
			<h2 class="text-highlighted text-lg font-semibold">О приложении</h2>
			<span class="text-dimmed text-sm">версия {{ currentVersion }}</span>
		</div>

		<section class="space-y-4">
			<h3 class="text-muted text-xs font-semibold uppercase">Что нового</h3>
			<ChangelogList />
		</section>
	</div>
</template>

<script lang="ts" setup>
const { currentVersion, markSeen } = useChangelog()

// opening this section counts as seeing the latest changelog — clear the badge
onMounted(markSeen)
</script>
