// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
	modules: ['@nuxt/ui'],
	devtools: {
		enabled: true
	},

	css: ['~/assets/css/main.css'],

	compatibilityDate: '2026-06-30',

	nitro: {
		preset: 'bun'
	}
})
