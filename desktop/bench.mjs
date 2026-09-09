// Local experiment, not an acceptance suite. No real microphone/camera is accessed.
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { collectGarbage, findChrome } from '../scripts/bench/harness.ts'

const root = join(import.meta.dirname, '..')
const exe = join(import.meta.dirname, 'src-tauri/target/release/voice-chat.exe')
const base = process.env.VOICECHAT_DESKTOP_BENCH_ORIGIN
if (!base || new URL(base).protocol !== 'https:') {
	throw new Error(
		'Set VOICECHAT_DESKTOP_BENCH_ORIGIN to the HTTPS origin embedded in voice-chat.exe'
	)
}
const output = join(root, '.data/desktop-memory')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
mkdirSync(output, { recursive: true })

function syntheticAudio() {
	window.__benchPCs = []
	const NativePC = window.RTCPeerConnection
	window.RTCPeerConnection = class extends NativePC {
		constructor(...args) {
			super(...args)
			window.__benchPCs.push(this)
		}
	}
	const play = HTMLMediaElement.prototype.play
	HTMLMediaElement.prototype.play = function () {
		this.muted = true
		return play.call(this)
	}
	navigator.mediaDevices.getUserMedia = async (constraints) => {
		if (constraints.video) throw new Error('This benchmark only supplies synthetic audio')
		const context = new AudioContext()
		const oscillator = context.createOscillator()
		const gain = context.createGain()
		const destination = context.createMediaStreamDestination()
		gain.gain.value = 0.03
		oscillator.frequency.value = 440
		oscillator.connect(gain).connect(destination)
		oscillator.start()
		await context.resume()
		window.__benchAudio = context
		return destination.stream
	}
}

async function audioStats(page) {
	return page.evaluate(async () => {
		let sent = 0
		let received = 0
		for (const pc of window.__benchPCs ?? []) {
			for (const stat of (await pc.getStats()).values()) {
				if (stat.kind !== 'audio') continue
				if (stat.type === 'outbound-rtp') sent += stat.bytesSent ?? 0
				if (stat.type === 'inbound-rtp') received += stat.bytesReceived ?? 0
			}
		}
		return { sent, received, visibility: document.visibilityState }
	})
}

async function login(context, username) {
	const response = await context.request.post(`${base}/api/auth/login`, {
		data: { username, password: 'password123', remember: true }
	})
	if (!response.ok())
		throw new Error(`Local fixture login failed: ${username}, ${response.status()}`)
	await context.addInitScript(syntheticAudio)
}

async function measure(page, pid, label) {
	await sleep(5000)
	await collectGarbage(page)
	execFileSync(
		'powershell.exe',
		[
			'-NoProfile',
			'-ExecutionPolicy',
			'Bypass',
			'-File',
			join(import.meta.dirname, 'measure.ps1'),
			'-Root',
			String(pid),
			'-Label',
			label
		],
		{ stdio: 'inherit' }
	)
}

function windowIsVisible(pid) {
	// The single-instance plugin owns a second window, <identifier>-siw.
	// MainWindowHandle selects that helper when the chat is hidden; it never becomes zero.
	const hidden = execFileSync(
		'powershell.exe',
		[
			'-NoProfile',
			'-Command',
			`(Get-Process -Id ${pid}).MainWindowTitle -eq 'ru.zabastx.voicechat-siw'`
		],
		{ encoding: 'utf8' }
	).trim()
	if (!['True', 'False'].includes(hidden)) throw new Error('Could not read native window state')
	return hidden === 'False'
}

async function waitForWindow(pid, visible) {
	for (let attempt = 0; attempt < 15; attempt++) {
		if (windowIsVisible(pid) === visible) return
		await sleep(500)
	}
	throw new Error(`Native window did not become ${visible ? 'visible' : 'hidden'}`)
}

const running = execFileSync(
	'powershell.exe',
	[
		'-NoProfile',
		'-Command',
		"@(Get-Process -Name 'voice-chat' -ErrorAction SilentlyContinue).Count"
	],
	{ encoding: 'utf8' }
).trim()
if (running !== '0') throw new Error('Close Voice Chat before benchmarking')
await fetch(base, { signal: AbortSignal.timeout(5000) })
const child = spawn(exe, [], {
	cwd: root,
	windowsHide: true,
	stdio: 'ignore',
	env: {
		...process.env,
		WEBVIEW2_USER_DATA_FOLDER: join(root, `.data/desktop-bench-profile-${Date.now()}`),
		WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9337'
	}
})
let desktop
let peer
try {
	for (let attempt = 0; attempt < 60; attempt++) {
		try {
			await fetch('http://127.0.0.1:9337/json/version', { signal: AbortSignal.timeout(1000) })
			break
		} catch {
			if (child.exitCode !== null || attempt === 59) throw new Error('WebView2 did not start')
			await sleep(500)
		}
	}
	desktop = await chromium.connectOverCDP('http://127.0.0.1:9337')
	const context = desktop.contexts()[0]
	await login(context, 'danil')
	const page = context.pages()[0]
	page.setDefaultTimeout(15000)
	const response = await context.request.get(`${base}/api/channels`)
	const channels = await response.json()
	const channel = channels.find((item) => item.name === 'bench-voice' && item.kind === 'voice')
	if (!channel) throw new Error('Seed bench-voice first with bun run bench:seed')
	await page.goto(`${base}/channels/${channel.id}`, { waitUntil: 'domcontentloaded' })
	await page.getByRole('button', { name: 'Подключиться', exact: true }).waitFor()
	await measure(page, child.pid, 'idle-voice-window')

	peer = await chromium.launch({ executablePath: findChrome(), headless: true })
	const peerContext = await peer.newContext()
	await login(peerContext, 'maks')
	const peerPage = await peerContext.newPage()
	peerPage.setDefaultTimeout(15000)
	await peerPage.goto(`${base}/channels/${channel.id}`, { waitUntil: 'domcontentloaded' })
	await peerPage.getByRole('button', { name: 'Подключиться', exact: true }).click()
	await page.getByRole('button', { name: 'Подключиться', exact: true }).click()
	await sleep(8000)
	const visibleStats = await audioStats(page)
	if (!(visibleStats.sent > 0 && visibleStats.received > 0)) {
		throw new Error(`Audio is not bidirectional: ${JSON.stringify(visibleStats)}`)
	}
	await page.screenshot({ path: join(output, 'call-window.png') })
	await measure(page, child.pid, 'call-window')

	execFileSync(exe, ['--tray'])
	await waitForWindow(child.pid, false)
	const before = await audioStats(page)
	await sleep(15000)
	const after = await audioStats(page)
	if (!(after.sent > before.sent && after.received > before.received)) {
		throw new Error(`Audio stalled in tray: ${JSON.stringify({ before, after })}`)
	}
	await measure(page, child.pid, 'call-tray')
	execFileSync(exe, [])
	await waitForWindow(child.pid, true)
	writeFileSync(
		join(output, 'call-evidence.json'),
		JSON.stringify(
			{
				date: new Date().toISOString(),
				base,
				channel: channel.name,
				participants: 2,
				media: 'WebAudio synthetic 440 Hz; no hardware capture; received media muted',
				visibleStats,
				nativeWindowHiddenInTray: true,
				trayBefore: before,
				trayAfter: after,
				restored: true
			},
			null,
			2
		)
	)
	console.log('PASS: login, bidirectional audio, audio in tray, single-instance hide/restore')
} finally {
	await peer?.close()
	await desktop?.close()
	child.kill()
}
