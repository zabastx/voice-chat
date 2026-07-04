<template>
	<UApp :locale="ru">
		<NuxtLayout>
			<NuxtPage />
		</NuxtLayout>
	</UApp>
</template>

<script lang="ts" setup>
import { ru } from '@nuxt/ui/locale'

useHead({
	title: 'Voice Chat',
	htmlAttrs: { lang: 'ru' },
	link: [
		{ rel: 'manifest', href: '/manifest.webmanifest' },
		{ rel: 'apple-touch-icon', href: '/icon-192.png' }
	],
	meta: [{ name: 'theme-color', content: '#059669' }]
})
</script>
