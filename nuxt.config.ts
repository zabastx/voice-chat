// https://nuxt.com/docs/api/configuration/nuxt-config
import pkg from './package.json'

export default defineNuxtConfig({
	modules: ['@nuxt/ui', 'nuxt-auth-utils'],
	devtools: {
		enabled: true
	},

	css: ['~/assets/css/main.css'],

	// <emoji-picker> is a web component (emoji-picker-element) used by ReactionPicker
	vue: {
		compilerOptions: {
			isCustomElement: (tag) => tag === 'emoji-picker'
		}
	},

	compatibilityDate: '2026-06-30',

	nitro: {
		preset: 'bun',
		experimental: {
			websocket: true
		}
	},

	vite: {
		server: {
			// lets the LiveKit dev container deliver webhooks to the dev server
			allowedHosts: ['host.docker.internal']
		}
	},

	runtimeConfig: {
		// dev default matches the postgres service in compose.dev.yaml
		databaseUrl: 'postgres://postgres:postgres@127.0.0.1:5432/voicechat',
		migrationsDir: 'server/db/migrations',
		livekitApiKey: 'devkey',
		livekitApiSecret: 'devsecret_at_least_32_characters_long',
		s3Endpoint: '',
		s3Bucket: '',
		s3Region: '',
		s3AccessKeyId: '',
		s3SecretAccessKey: '',
		// Telegram notifications bridge, via the standalone telegram-relay service
		// (see telegram-relay/ + adr/0006). Unset = feature disabled. The main app
		// never talks to api.telegram.org directly — the relay does.
		telegramRelayUrl: '',
		telegramRelaySecret: '',
		public: {
			livekitUrl: 'ws://127.0.0.1:7880',
			appVersion: pkg.version,
			// bot @username, used to build the t.me/<bot>?start=<token> deep link
			telegramBotUsername: ''
		}
	}
})
