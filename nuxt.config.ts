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

	// Private site: never index, never archive, never train on it. `robots.txt`
	// stops well-behaved crawlers before they fetch anything, so this header is
	// what covers the ones that fetch first and read directives after — and it
	// applies to API responses and static assets too, which robots.txt rules do
	// not describe individually. `noai`/`noimageai` are non-standard but honoured
	// by a few scrapers; the rest is the Google/Bing set.
	routeRules: {
		'/**': {
			headers: {
				'X-Robots-Tag':
					'noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai'
			}
		}
	},

	vite: {
		server: {
			// Vite rejects unknown Host headers (DNS-rebinding guard), which blocks anything
			// reaching the dev server under a name other than localhost. Dev-only — prod is
			// served by Nitro, which has no such check.
			allowedHosts: [
				// lets the LiveKit dev container deliver webhooks to the dev server
				'host.docker.internal',
				// tunnels, for driving VK Callback (adr/0011) against a local dev server;
				// a leading dot matches any subdomain
				'.ngrok-free.dev',
				'.ngrok.io',
				// escape hatch for any other tunnel provider: NUXT_DEV_ALLOWED_HOSTS=a.example,b.example
				...(process.env.NUXT_DEV_ALLOWED_HOSTS?.split(',').filter(Boolean) ?? [])
			]
		}
	},

	runtimeConfig: {
		session: {
			// Seal lifetime ONLY — a backstop, deliberately far longer than any cookie
			// we actually write. h3 derives both the seal's ttl and (by default) the
			// cookie's expiry from this plus `session.createdAt`, and createdAt never
			// moves once a cookie exists (GOTCHAS #24) — so a rolling window cannot be
			// built on it, and leaving this at 400 days would hard-expire the seal 400
			// days after a member's FIRST login however active they were since.
			// `issueSignIn` writes the real, rolling expiry itself; this only has to
			// outlive it. See docs/adr/0012.
			maxAge: 10 * 365 * 24 * 60 * 60
		},
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
		// VK notifications (adr/0011). Sending needs a community access key with the
		// messages/photos/docs rights plus the numeric community id; unset = disabled.
		vkToken: '',
		vkGroupId: '',
		// which inbound transport runs: 'longpoll' (outbound-only, the default and
		// what adr/0011 chose) or 'callback'. Never both — VK would deliver twice.
		vkInbound: 'longpoll',
		// Callback API only, when vkInbound is 'callback'. Unset = the route 404s.
		// The confirmation string rotates: read the current one from Управление →
		// Работа с API → Callback API, or via groups.getCallbackConfirmationCode.
		vkConfirmationCode: '',
		vkCallbackSecret: '',
		// Desktop Update feed (adr/0014). The feed reads published GitHub Releases
		// of this repo; no token is needed while it is public, and one only raises
		// the rate limit. Set the fixture path to serve a local JSON catalog
		// instead — for driving the feed without publishing a Release.
		desktopReleaseRepo: 'zabastx/voice-chat',
		desktopReleaseFixture: '',
		desktopGithubToken: '',
		// the minimum supported Desktop Release, tracked independently of the
		// offered one: raise it only for a security issue or an incompatible
		// protocol change. Unset = nothing is required.
		desktopMinimumVersion: '',
		desktopUpdateCacheSeconds: 300,
		public: {
			livekitUrl: 'ws://127.0.0.1:7880',
			appVersion: pkg.version,
			// bot @username, used to build the t.me/<bot>?start=<token> deep link
			telegramBotUsername: '',
			// numeric community id, for the vk.me/club<id>?ref=<token> deep link
			vkGroupId: '',
			// where the Desktop Download points when the feed cannot answer (503):
			// every Release of the repo the feed reads, drafts hidden by GitHub
			desktopReleasesPage: 'https://github.com/zabastx/voice-chat/releases'
		}
	}
})
