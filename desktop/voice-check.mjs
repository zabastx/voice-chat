// A Voice Channel joined from the desktop shell stays joined. Drives the debug shell against the
// local dev stack (`bun run dev` + compose.dev.yaml) through WebView2 CDP; no hardware prompt,
// the microphone is granted over CDP. Regression for LiveKit's `beforeunload` page-leave hook
// firing on the Native Bridge's cancelled navigation (GOTCHAS 34).
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { chromium } from 'playwright-core'

const root = join(import.meta.dirname, '..')
const tauriRoot = join(import.meta.dirname, 'src-tauri')
const exe = join(tauriRoot, 'target', 'debug', 'voice-chat.exe')
const base = process.env.VOICECHAT_DESKTOP_URL ?? 'http://localhost:3000'
const debugPort = 9351
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

const running = execFileSync(
	'powershell.exe',
	[
		'-NoProfile',
		'-Command',
		"@(Get-Process | Where-Object { $_.ProcessName -match '^(voice-chat|Voice.Chat)' }).Count"
	],
	{ encoding: 'utf8' }
).trim()
if (running !== '0') throw new Error('Close Voice Chat first: the shell is single-instance')
await fetch(base, { signal: AbortSignal.timeout(5000) }).catch(() => {
	throw new Error(`Start the dev stack first: ${base} is not answering`)
})

const env = { ...process.env }
const localCargo = join(root, '.data', 'tooling', 'cargo')
if (!env.CARGO_HOME && existsSync(join(localCargo, 'bin', 'cargo.exe'))) {
	env.CARGO_HOME = localCargo
	env.RUSTUP_HOME = join(root, '.data', 'tooling', 'rustup')
	env.PATH = `${join(localCargo, 'bin')}${delimiter}${env.PATH ?? ''}`
}
env.VOICECHAT_DESKTOP_UPDATER_PUBKEY ??= 'compile-only-not-a-release-key'
execFileSync('cargo', ['build'], { cwd: tauriRoot, env, stdio: 'inherit' })

const profile = mkdtempSync(join(tmpdir(), 'voice-chat-voice-check-'))
const child = spawn(exe, [], {
	windowsHide: true,
	stdio: 'ignore',
	env: {
		...process.env,
		VOICECHAT_DESKTOP_URL: base,
		WEBVIEW2_USER_DATA_FOLDER: profile,
		WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`
	}
})
let browser
try {
	for (let attempt = 0; attempt < 60 && !browser; attempt++) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
		} catch {
			if (child.exitCode !== null) throw new Error('Voice Chat exited before exposing CDP')
			await sleep(500)
		}
	}
	if (!browser) throw new Error('Voice Chat did not expose its test CDP endpoint')
	const context = browser.contexts()[0]
	const login = await context.request.post(`${base}/api/auth/login`, {
		data: { username: 'danil', password: 'password123', remember: true }
	})
	if (!login.ok()) throw new Error(`Local fixture login failed: ${login.status()}`)
	const cdp = await browser.newBrowserCDPSession()
	await cdp.send('Browser.grantPermissions', { origin: base, permissions: ['audioCapture'] })

	const page = context.pages()[0]
	page.setDefaultTimeout(20_000)
	const liveKitLog = []
	page.on('console', (message) => liveKitLog.push(message.text()))
	// the shell's own first navigation can still be settling when the harness arrives
	for (let attempt = 0; ; attempt++) {
		try {
			await page.goto(`${base}/`, { waitUntil: 'load' })
			break
		} catch (error) {
			if (attempt > 10) throw error
			await sleep(1000)
		}
	}
	const channels = await page.evaluate(async () => (await fetch('/api/channels')).json())
	const channel = channels.find((item) => item.kind === 'voice')
	if (!channel) throw new Error('The local database has no Voice Channel')
	await page.goto(`${base}/channels/${channel.id}`, { waitUntil: 'load' })

	// a click that lands before hydration does nothing, so retry until the call starts
	const joinButton = page.getByRole('button', { name: 'Подключиться', exact: true })
	for (let attempt = 0; attempt < 10; attempt++) {
		await joinButton.click({ timeout: 5000 }).catch(() => {})
		const started = await page
			.waitForFunction(() => document.body.innerText.includes('Подключение'), null, {
				timeout: 4000
			})
			.then(
				() => true,
				() => false
			)
		if (started || liveKitLog.some((line) => line.includes('connecting -> connected'))) break
	}
	// setVoiceActive(true) is sent right after connect; give the bridge and the mic time to land
	await sleep(5000)

	const joined = liveKitLog.some((line) => line.includes('connecting -> connected'))
	const published = liveKitLog.some((line) => line.includes('publishing track'))
	const leftOnItsOwn = liveKitLog.some((line) => line.includes('Page leave detected'))
	const text = await page.locator('body').innerText()
	const withoutMic = text.includes('Вы подключились без микрофона')
	if (!joined) throw new Error('The desktop shell never connected to LiveKit')
	if (leftOnItsOwn) {
		throw new Error('LiveKit treated a Native Bridge navigation as leaving the page')
	}
	if (!published || withoutMic) throw new Error('Joined, but the microphone was not published')
	console.log('PASS voice: the desktop shell stays in the Voice Channel with its microphone')
} finally {
	await browser?.close().catch(() => {})
	child.kill()
	await sleep(1000)
	rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
