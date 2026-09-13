<template>
	<p v-if="compact && (state === 'offer' || state === 'fallback')" class="text-muted text-sm">
		<template v-if="state === 'offer' && download">
			Есть приложение для Windows —
			<ULink :href="download.setupUrl" class="text-primary font-medium" external>скачать</ULink>
		</template>
		<template v-else-if="state === 'fallback'">
			Есть приложение для Windows —
			<ULink :href="releasesPage" class="text-primary font-medium" external target="_blank">
				скачать на GitHub
			</ULink>
		</template>
	</p>

	<section v-else-if="!compact && state !== 'none'" class="space-y-3">
		<h3 class="text-muted text-xs font-semibold uppercase">Приложение для Windows</h3>

		<p v-if="state === 'desktop'" class="text-sm">{{ desktopNote }}</p>

		<p v-else-if="state === 'unsupported'" class="text-muted text-sm">
			Пока только для Windows 10/11 x64.
		</p>

		<template v-else>
			<p class="text-muted text-sm">Работает из трея, пока окно закрыто, и само обновляется.</p>
			<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
				<UButton
					v-if="state === 'offer' && download"
					:href="download.setupUrl"
					external
					icon="i-lucide-download"
					:label="`Скачать ${download.version}`"
				/>
				<UButton
					v-else
					:href="releasesPage"
					external
					icon="i-lucide-external-link"
					label="Скачать на GitHub"
					target="_blank"
				/>
				<template v-if="state === 'offer' && download">
					<ULink :href="download.portableUrl" class="text-sm" external> Портативная версия </ULink>
					<ULink :href="download.releaseUrl" class="text-sm" external target="_blank">
						Страница выпуска
					</ULink>
				</template>
			</div>
			<p class="text-dimmed text-xs">
				Альфа-версия. Windows может предупредить о неизвестном издателе — нажмите «Подробнее» →
				«Выполнить в любом случае».
			</p>
		</template>
	</section>
</template>

<script lang="ts" setup>
// The Desktop Download (CONTEXT.md). `compact` is the one-line form for the
// login and register pages, shown only where there is something to install;
// without it this is the section in «О приложении».
defineProps<{ compact?: boolean }>()

const { state, download, releasesPage, desktopVersion } = useDesktopDownload()

const desktopNote = computed(() =>
	desktopVersion
		? `Вы в приложении для Windows, версия ${desktopVersion}. Обновления приходят сами.`
		: 'Вы в приложении для Windows. Обновления приходят сами.'
)
</script>
