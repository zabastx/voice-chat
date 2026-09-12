// Drives the running app in two browsers and counts what each notification transport was
// asked to show (#11). The desktop harness proves a toast can reach Windows from the tray;
// this one proves the decision in front of it — that a DM or a mention raises exactly one
// notification, that an open conversation raises none, and that the browser and the
// Desktop Client answer the same way.
//
//   docker compose -f compose.dev.yaml up -d
//   PORT=3001 bun run dev
//   bun run notify:check            # VOICECHAT_APP_URL overrides the address
//
// Needs the seeded dev accounts (`danil` / `maks`). Nothing reaches a real desktop: both
// transports are replaced in the page before the app loads.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'

import { findChrome } from './bench/harness'

const base = process.env.VOICECHAT_APP_URL ?? 'http://localhost:3001'
const password = 'password123'
// Cached session cookies, so repeat runs do not spend the login rate limit (10 per 15 min
// per IP, requireRateLimit in login.post). Same shape and reason as scripts/bench/harness.
const stateDir = join(import.meta.dirname, '..', '.data', 'notify')
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

declare global {
	var __seen: { web: { title: string; body?: string }[]; native: { title: string; body: string }[] }
	var __delivered: string[]
	var __permissionAsks: number
	var __shellSetForeground: (foreground: boolean) => void
}

/**
 * Replaces both transports with recorders and taps the realtime socket. The socket tap is
 * what makes a zero meaningful: a scenario that counted no notifications has to prove the
 * message arrived at all, or it is indistinguishable from a dropped connection.
 */
const recorder = (permission: 'granted' | 'denied') => `(() => {
  globalThis.__seen = { web: [], native: [] }
  globalThis.__delivered = []
  globalThis.__permissionAsks = 0
  class RecordingNotification {
    static permission = ${JSON.stringify(permission)}
    static requestPermission() {
      globalThis.__permissionAsks += 1
      return Promise.resolve(RecordingNotification.permission)
    }
    constructor(title, options) { globalThis.__seen.web.push({ title, body: options?.body }) }
    close() {}
  }
  Object.defineProperty(globalThis, 'Notification', {
    value: RecordingNotification, writable: true, configurable: true
  })
  const RealSocket = globalThis.WebSocket
  globalThis.WebSocket = class extends RealSocket {
    constructor(...args) {
      super(...args)
      this.addEventListener('message', (event) => {
        if (typeof event.data !== 'string' || !event.data.includes('message.created')) return
        try { globalThis.__delivered.push(JSON.parse(event.data).message?.content ?? '') } catch {}
      })
    }
  }
})()`

/** Stands in for the Desktop Client's frozen descriptor, shell included. */
const desktopShell = `(() => {
  let foreground = true
  const watchers = new Set()
  Object.defineProperty(globalThis, 'voiceChatDesktop', {
    value: Object.freeze({
      desktopVersion: '0.1.0-alpha.1',
      bridgeVersion: 1,
      capabilities: Object.freeze(['voice-lifecycle', 'notifications', 'window-focus']),
      setVoiceActive() {},
      showNotification(notification) { globalThis.__seen.native.push(notification) },
      isForeground() { return foreground },
      onForegroundChange(listener) {
        watchers.add(listener)
        return () => watchers.delete(listener)
      }
    }),
    writable: false, configurable: false
  })
  // what the shell does on show, hide, close-to-tray and WindowEvent::Focused
  globalThis.__shellSetForeground = (next) => {
    if (next === foreground) return
    foreground = next
    for (const watcher of [...watchers]) watcher(next)
  }
})()`

const failures: string[] = []
function check(label: string, passed: boolean, detail: string) {
	console.log(`${passed ? 'PASS' : 'FAIL'} ${label} — ${detail}`)
	if (!passed) failures.push(label)
}

async function signIn(context: BrowserContext, username: string): Promise<Page> {
	// Authenticated over the API, never through the login form: the form no-ops until Nuxt
	// has hydrated, and on a cold dev server that is slower than any fixed wait — which
	// turns a correct run into a flake. What this script verifies is notifications, not the
	// form. The session is cached and probed first so a re-run spends no login attempt.
	mkdirSync(stateDir, { recursive: true })
	const statePath = join(stateDir, `${username}.json`)
	if (existsSync(statePath)) {
		await context.addCookies(JSON.parse(readFileSync(statePath, 'utf8')))
	}
	// any session-gated GET works as the probe; /api/channels is the cheapest
	const probe = await context.request.get(`${base}/api/channels`, { failOnStatusCode: false })
	if (!probe.ok()) {
		const response = await context.request.post(`${base}/api/auth/login`, {
			data: { username, password, remember: true },
			failOnStatusCode: false
		})
		if (!response.ok()) throw new Error(`Вход ${username} не удался: ${response.status()}`)
		writeFileSync(statePath, JSON.stringify(await context.cookies(), null, '\t'))
	}
	const page = await context.newPage()
	// an origin has to exist before the recorder's fetch/evaluate calls or a reload can run
	await page.goto(base)
	await sleep(1500)
	return page
}

async function setNotifications(page: Page, on: boolean) {
	await page.evaluate((enabled) => {
		const prefs = JSON.parse(localStorage.getItem('voice-chat:prefs') ?? '{}')
		prefs.desktopNotifications = enabled
		localStorage.setItem('voice-chat:prefs', JSON.stringify(prefs))
	}, on)
	await page.reload()
	await sleep(2000)
}

let browser: Browser | undefined
try {
	browser = await chromium.launch({ executablePath: findChrome(), headless: true })

	const sender = await browser.newContext()
	const danil = await signIn(sender, 'danil')

	const [dmChannel, maksId, textChannel] = await danil.evaluate(async () => {
		const members = await fetch('/api/members').then((response) => response.json())
		const maks = members.find((member: { username: string }) => member.username === 'maks')
		const convo = await fetch('/api/dm', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ memberId: maks.id })
		}).then((response) => response.json())
		const channels = await fetch('/api/channels').then((response) => response.json())
		const text = channels.find((channel: { kind: string }) => channel.kind === 'text')
		return [convo.channelId ?? convo.id, maks.id, text.id] as const
	})

	const seen = (page: Page) =>
		page.evaluate(() => ({
			web: globalThis.__seen.web.length,
			native: globalThis.__seen.native.length,
			asks: globalThis.__permissionAsks
		}))

	/** Sends one message and waits for the reader's own socket to have it. */
	async function deliver(reader: Page, content: string, channelId: string) {
		await reader.evaluate(() => {
			globalThis.__seen.web.length = 0
			globalThis.__seen.native.length = 0
		})
		await danil.evaluate(
			async ([id, text]) => {
				await fetch(`/api/channels/${id}/messages`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ content: text })
				})
			},
			[channelId, content] as const
		)
		await reader.waitForFunction((marker) => globalThis.__delivered.includes(marker), content, {
			timeout: 15_000
		})
		// the realtime handler runs on the same frame; give it one
		await sleep(400)
	}

	// --- a plain browser --------------------------------------------------------------
	const browsing = await browser.newContext({ permissions: ['notifications'] })
	await browsing.addInitScript(recorder('granted'))
	const maksWeb = await signIn(browsing, 'maks')
	await setNotifications(maksWeb, true)
	await maksWeb.goto(`${base}/channels/${dmChannel}`)
	await sleep(1500)

	await deliver(maksWeb, 'разговор открыт на экране', dmChannel)
	let counts = await seen(maksWeb)
	check(
		'браузер: открытый разговор в фокусе молчит',
		counts.web === 0 && counts.native === 0,
		`web=${counts.web} native=${counts.native}`
	)

	await maksWeb.evaluate(() => globalThis.dispatchEvent(new Event('blur')))
	await deliver(maksWeb, 'личное сообщение мимо фокуса', dmChannel)
	counts = await seen(maksWeb)
	check(
		'браузер: DM без фокуса даёт ровно одно уведомление',
		counts.web === 1 && counts.native === 0,
		`web=${counts.web} native=${counts.native}`
	)

	await setNotifications(maksWeb, false)
	await maksWeb.evaluate(() => globalThis.dispatchEvent(new Event('blur')))
	await deliver(maksWeb, 'настройка выключена', dmChannel)
	counts = await seen(maksWeb)
	check(
		'браузер: выключенная настройка молчит',
		counts.web === 0 && counts.native === 0,
		`web=${counts.web} native=${counts.native}`
	)

	// --- a browser that was told no ---------------------------------------------------
	const refused = await browser.newContext()
	await refused.addInitScript(recorder('denied'))
	const maksRefused = await signIn(refused, 'maks')
	await setNotifications(maksRefused, true)
	await maksRefused.evaluate(() => globalThis.dispatchEvent(new Event('blur')))
	await deliver(maksRefused, 'уведомления запрещены браузером', dmChannel)
	counts = await seen(maksRefused)
	check(
		'браузер: запрет не создаёт уведомлений и не перезапрашивается',
		counts.web === 0 && counts.native === 0 && counts.asks === 0,
		`web=${counts.web} native=${counts.native} запросов=${counts.asks}`
	)

	// --- a Desktop Client -------------------------------------------------------------
	const shell = await browser.newContext()
	await shell.addInitScript(recorder('denied')) // WebView2's real answer, GOTCHAS 31
	await shell.addInitScript(desktopShell)
	const maksDesktop = await signIn(shell, 'maks')
	await setNotifications(maksDesktop, true)
	await maksDesktop.goto(`${base}/channels/${dmChannel}`)
	await sleep(1500)

	await deliver(maksDesktop, 'desktop: разговор открыт и окно видно', dmChannel)
	counts = await seen(maksDesktop)
	check(
		'desktop: открытый разговор в видимом окне молчит',
		counts.web === 0 && counts.native === 0,
		`web=${counts.web} native=${counts.native}`
	)

	// Into the tray. `document.hasFocus()` stays true here exactly as it does in the real
	// WebView2 (GOTCHAS 30) — only the shell's answer changes.
	const claimsFocusWhileHidden = await maksDesktop.evaluate(() => {
		globalThis.__shellSetForeground(false)
		return document.hasFocus()
	})
	await deliver(maksDesktop, 'desktop: сообщение, пока клиент в трее', dmChannel)
	counts = await seen(maksDesktop)
	check(
		'desktop: DM в трее даёт ровно одно уведомление, и только через bridge',
		counts.native === 1 && counts.web === 0 && claimsFocusWhileHidden,
		`native=${counts.native} web=${counts.web} document.hasFocus()=${claimsFocusWhileHidden}`
	)

	await deliver(maksDesktop, `<@${maksId}> посмотри, пожалуйста`, textChannel)
	counts = await seen(maksDesktop)
	check(
		'desktop: упоминание в трее даёт ровно одно уведомление',
		counts.native === 1 && counts.web === 0,
		`native=${counts.native} web=${counts.web}`
	)

	await maksDesktop.evaluate(() => globalThis.__shellSetForeground(true))
	await deliver(maksDesktop, 'desktop: окно снова на экране', dmChannel)
	counts = await seen(maksDesktop)
	check(
		'desktop: после возврата из трея открытый разговор снова молчит',
		counts.native === 0 && counts.web === 0,
		`native=${counts.native} web=${counts.web}`
	)
} finally {
	await browser?.close().catch(() => {})
}

if (failures.length > 0) {
	console.error(`\n${failures.length} сценариев не прошли:\n  ${failures.join('\n  ')}`)
	process.exit(1)
}
console.log('\nAll notification scenarios passed.')
