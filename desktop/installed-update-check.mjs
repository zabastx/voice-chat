// Proves the installed update path against two real signed artifacts: the member agrees,
// the call is waited out, the signed installer replaces the client, it comes back signed
// in, and a tampered signature is refused. Both artifacts are built from this working
// tree — the second one only differs by the version the Tauri config override gives it.
import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { desktopReleaseArtifacts } from '../scripts/desktop-artifacts.ts'
import { generateUpdaterKey, signArtifact } from '../scripts/desktop-signing.ts'
import { expectOffer, INSTALL, offerMessage, POSTPONE, readOffer } from './update-dialog.mjs'

const root = join(import.meta.dirname, '..')
const tauriRoot = join(import.meta.dirname, 'src-tauri')
const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8'))
const bundleDirectory = join(tauriRoot, 'target', 'release', 'bundle', 'nsis')
const localAppData = process.env.LOCALAPPDATA
const roamingAppData = process.env.APPDATA
if (!localAppData || !roamingAppData) throw new Error('Windows app-data paths are unavailable')
const installDirectory = join(localAppData, 'Voice Chat')
const installed = join(installDirectory, 'voice-chat.exe')
const uninstaller = join(installDirectory, 'uninstall.exe')
const localProfile = join(localAppData, config.identifier)
const roamingProfile = join(roamingAppData, config.identifier)
const desktopLog = join(localProfile, 'logs', 'voice-chat.log')
const NEXT_VERSION = `${config.version}.1`
const NOTES = 'Тестовое обновление installed-клиента.'
const QUESTION =
	'Установить обновление? Клиент перезапустится, а если идёт разговор в голосовом канале, установка дождётся его окончания.'
const sessionCookie = `voice-chat-installed-update=${randomUUID()}`

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const listen = (server, port = 0) =>
	new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', resolve)
	})
const close = (server) =>
	new Promise((resolve) => {
		if (!server?.listening) return resolve()
		server.close(resolve)
		server.closeAllConnections?.()
	})
const waitFor = async (predicate, label, attempts = 160) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (await predicate()) return
		await sleep(250)
	}
	throw new Error(`Timed out waiting for ${label}`)
}
const powershell = (command, env = {}) =>
	execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
		encoding: 'utf8',
		env: { ...process.env, ...env }
	})?.trim()
const logEventCount = (event) =>
	existsSync(desktopLog) ? readFileSync(desktopLog, 'utf8').split(event).length - 1 : 0
const installedVersion = () =>
	powershell('(Get-Item -LiteralPath $env:VC_EXE).VersionInfo.ProductVersion', {
		VC_EXE: installed
	})
const runningClients = () =>
	Number(
		powershell(
			'@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $env:VC_EXE }).Count',
			{ VC_EXE: installed }
		)
	)

/** Launches the installed client with a debugger port so the fixture page can be driven. */
async function launch(debugPort) {
	const child = spawn(installed, [], {
		stdio: 'ignore',
		env: {
			...process.env,
			WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`
		}
	})
	let browser
	for (let attempt = 0; attempt < 80; attempt += 1) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
			break
		} catch {
			if (child.exitCode !== null) throw new Error('The installed client exited before WebView2')
			await sleep(250)
		}
	}
	if (!browser) throw new Error('The installed client did not expose its test CDP endpoint')
	const [context] = browser.contexts()
	const [page] = context.pages()
	await page.locator('#update-check').waitFor({ timeout: 15_000 })
	return { browser, child, page }
}

async function stop(client) {
	if (!client) return
	if (client.child.exitCode === null) {
		execFileSync(installed, ['--exit'])
		await waitFor(() => client.child.exitCode !== null, 'installed client exit')
	}
	await client.browser.close().catch(() => {})
}

const setVoiceActive = (page, active) =>
	page.evaluate((value) => globalThis.voiceChatDesktop.setVoiceActive(value), active)

if (process.platform !== 'win32' || process.arch !== 'x64') {
	throw new Error('The installed update check requires Windows x64')
}
for (const path of [installDirectory, localProfile, roamingProfile]) {
	if (existsSync(path)) {
		throw new Error(`Refusing to touch an existing Voice Chat installation or profile: ${path}`)
	}
}

const temp = mkdtempSync(join(tmpdir(), 'voice-chat-installed-update-'))
let server
let client
try {
	const reservation = createNetServer()
	await listen(reservation, Number(process.env.VOICECHAT_DESKTOP_INSTALLED_UPDATE_PORT ?? '0'))
	const port = reservation.address().port
	await close(reservation)
	const origin = `http://localhost:${port}`
	// The artifacts and the signature have to come from one key pair, so reusing a build
	// means reusing the key that build was stamped with.
	const skipBuild = process.env.VOICECHAT_DESKTOP_SKIP_BUILD === '1'
	const keyDirectory = process.env.VOICECHAT_DESKTOP_UPDATER_KEY_DIR
	if (skipBuild && !keyDirectory) {
		throw new Error(
			'Skipping the build needs VOICECHAT_DESKTOP_UPDATER_KEY_DIR from the run that built it'
		)
	}
	const key = generateUpdaterKey(keyDirectory ?? temp)

	const current = join(temp, 'current-setup.exe')
	const next = join(temp, 'next-setup.exe')
	for (const [version, destination] of [
		[config.version, current],
		[NEXT_VERSION, next]
	]) {
		if (!skipBuild) {
			console.log(`Building the installer for ${version} against the fixture update feed`)
			execFileSync('bun', ['scripts/desktop.ts', 'build'], {
				cwd: root,
				stdio: 'inherit',
				env: {
					...process.env,
					VOICECHAT_DESKTOP_PRODUCTION_ORIGIN: origin,
					VOICECHAT_DESKTOP_UPDATE_CHECK: '1',
					VOICECHAT_DESKTOP_UPDATER_PUBKEY: key.publicKey,
					VOICECHAT_DESKTOP_VERSION: version
				}
			})
		}
		const built = join(bundleDirectory, desktopReleaseArtifacts(version).setup)
		if (!existsSync(built)) throw new Error(`The installer for ${version} is missing: ${built}`)
		copyFileSync(built, destination)
	}
	const signature = signArtifact(key, next)
	// signing an unrelated artifact is how a member would meet a swapped download: the
	// bytes verify against some key, just not against the one this client was built with
	const decoy = join(temp, 'decoy-setup.exe')
	writeFileSync(decoy, readFileSync(current))
	const otherKeyDirectory = mkdtempSync(join(temp, 'other-key-'))
	const wrongSignature = signArtifact(generateUpdaterKey(otherKeyDirectory), decoy)

	// what the feed answers next, and what the download actually serves
	let feed = 'offer'
	let feedRequests = 0
	let assetRequests = 0
	let signedInRequests = 0
	const feedQueries = []
	server = createHttpServer((request, response) => {
		const url = new URL(request.url, origin)
		if (url.pathname === '/api/desktop/update') {
			feedRequests += 1
			feedQueries.push(Object.fromEntries(url.searchParams))
			if (feed === 'silent') {
				response.writeHead(204).end()
				return
			}
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(
				JSON.stringify({
					version: NEXT_VERSION,
					notes: NOTES,
					pub_date: new Date().toISOString(),
					release_url: `${origin}/releases/tag/desktop-v${NEXT_VERSION}`,
					platforms: {
						'windows-x86_64': {
							signature: feed === 'tampered' ? wrongSignature : signature,
							url: `${origin}/download/setup.exe`
						}
					}
				})
			)
			return
		}
		if (url.pathname === '/download/setup.exe') {
			assetRequests += 1
			const bytes = readFileSync(feed === 'tampered' ? decoy : next)
			response.writeHead(200, {
				'content-type': 'application/octet-stream',
				'content-length': bytes.length
			})
			response.end(bytes)
			return
		}
		const signedIn = request.headers.cookie?.split('; ').includes(sessionCookie) === true
		if (signedIn) signedInRequests += 1
		response.writeHead(200, {
			'content-type': 'text/html; charset=utf-8',
			...(signedIn
				? {}
				: {
						'set-cookie': `${sessionCookie}; Max-Age=3600; HttpOnly; SameSite=Strict; Path=/`
					})
		})
		response.end(
			`<!doctype html><title>Voice Chat installed update check</title><main id="update-check" data-signed-in="${signedIn}">ready</main>`
		)
	})
	await listen(server, port)

	execFileSync(current, ['/S'], { windowsHide: true, timeout: 120_000 })
	if (!existsSync(installed) || !existsSync(uninstaller)) {
		throw new Error('The per-user NSIS install did not create the application')
	}
	if (installedVersion() !== config.version) {
		throw new Error(`Installed ${installedVersion()} instead of ${config.version}`)
	}

	const message = offerMessage(NEXT_VERSION, NOTES, QUESTION)
	let postponed = logEventCount('desktop update postponed')
	client = await launch(9351)
	// the first page load signs this profile in; the restarted client must keep it
	await client.page.reload({ waitUntil: 'domcontentloaded' })
	if ((await client.page.locator('#update-check').getAttribute('data-signed-in')) !== 'true') {
		throw new Error('The installed client did not persist its Sign-in cookie')
	}
	const reach = await client.page.evaluate(async () => {
		const invoke = globalThis.__TAURI_INTERNALS__?.invoke
		if (typeof invoke !== 'function') return 'no invoke'
		try {
			await invoke('plugin:updater|check', {})
			return 'allowed'
		} catch (error) {
			return `denied: ${error}`
		}
	})
	if (reach === 'allowed') throw new Error('The remote page reached the updater through Tauri')
	const bridge = await client.page.evaluate(() => ({
		keys: Object.keys(globalThis.voiceChatDesktop),
		rejectsNonBoolean: (() => {
			try {
				globalThis.voiceChatDesktop.setVoiceActive('1')
				return false
			} catch {
				return true
			}
		})()
	}))
	if (!bridge.rejectsNonBoolean) throw new Error('The bridge accepted a non-boolean voice flag')
	if (bridge.keys.join(',') !== 'desktopVersion,bridgeVersion,capabilities,setVoiceActive') {
		throw new Error(`The bridge exposed ${JSON.stringify(bridge.keys)}`)
	}
	console.log(`PASS installed: the remote page gets one boolean and no updater (${reach})`)
	await waitFor(() => feedRequests >= 1, 'startup update check')
	const declined = readOffer({ click: POSTPONE })
	expectOffer(declined, { message, accept: INSTALL })
	if (declined.clicked !== POSTPONE) throw new Error(`Could not press «${POSTPONE}»`)
	await waitFor(
		() => logEventCount('desktop update postponed') > postponed,
		'the postponed offer in the local desktop log'
	)
	if (assetRequests !== 0) throw new Error('A postponed update downloaded its installer anyway')
	if (installedVersion() !== config.version)
		throw new Error('A postponed update replaced the client')
	console.log('PASS installed: a postponed update downloads and installs nothing')
	await stop(client)
	client = undefined

	feed = 'tampered'
	const failures = logEventCount('desktop update install failed')
	client = await launch(9352)
	await waitFor(() => feedRequests >= 2, 'update check offering the tampered Release')
	const tampered = readOffer({ click: INSTALL })
	expectOffer(tampered, { message, accept: INSTALL })
	if (tampered.clicked !== INSTALL) throw new Error(`Could not press «${INSTALL}»`)
	await waitFor(
		() => logEventCount('desktop update install failed') > failures,
		'the refused signature in the local desktop log'
	)
	if (installedVersion() !== config.version) {
		throw new Error('An artifact signed with another key replaced the client')
	}
	if (client.child.exitCode !== null) throw new Error('A refused update stopped the client')
	console.log('PASS installed: an artifact signed with another key is refused')
	await stop(client)
	client = undefined

	feed = 'offer'
	const waits = logEventCount('desktop update waiting for voice channel')
	const downloadsBefore = assetRequests
	client = await launch(9353)
	await setVoiceActive(client.page, true)
	await waitFor(
		() => logEventCount('voice channel active') > 0,
		'the shell learning about the call'
	)
	await waitFor(() => feedRequests >= 3, 'update check during a Voice Channel')
	const agreed = readOffer({ click: INSTALL })
	expectOffer(agreed, { message, accept: INSTALL })
	if (agreed.clicked !== INSTALL) throw new Error(`Could not press «${INSTALL}»`)
	await waitFor(
		() => logEventCount('desktop update waiting for voice channel') > waits,
		'the deferred install in the local desktop log'
	)
	// long enough to cover several poll intervals of the deferral
	await sleep(15_000)
	if (assetRequests !== downloadsBefore) {
		throw new Error('An agreed update downloaded its installer during a Voice Channel')
	}
	if (client.child.exitCode !== null) throw new Error('An agreed update stopped the call')
	console.log('PASS installed: an agreed update waits for the Voice Channel to end')

	// from here on nothing but a restarted client can ask this server for the page
	const signedInBeforeRestart = signedInRequests
	await setVoiceActive(client.page, false)
	await waitFor(() => assetRequests > downloadsBefore, 'the signed installer download', 240)
	await waitFor(() => client.child.exitCode !== null, 'the client exiting for its installer', 480)
	await client.browser.close().catch(() => {})
	client = undefined
	await waitFor(
		() => installedVersion() === NEXT_VERSION,
		'the installed client to be replaced',
		480
	)
	await waitFor(() => runningClients() === 1, 'the updated client to restart itself', 480)
	await waitFor(
		() => feedQueries.some((query) => query.version === NEXT_VERSION),
		'the restarted client checking in with its new version',
		480
	)
	await waitFor(
		() => signedInRequests > signedInBeforeRestart,
		'the restarted client loading the Web Release with its Sign-in',
		480
	)
	console.log('PASS installed: the signed update installs after the call and restarts signed in')

	feed = 'silent'
	execFileSync(installed, ['--exit'])
	await waitFor(() => runningClients() === 0, 'the updated client to exit')
	execFileSync(uninstaller, ['/S'], { windowsHide: true, timeout: 120_000 })
	await waitFor(
		() => !existsSync(installDirectory) && !existsSync(localProfile) && !existsSync(roamingProfile),
		'the application and shared profile removal'
	)
	console.log('PASS installed: the updated client uninstalls itself and its profile')
} finally {
	await stop(client).catch(() => client?.child?.kill())
	// never leave a test client installed against a fixture origin that is about to close
	if (existsSync(uninstaller)) {
		try {
			execFileSync(uninstaller, ['/S'], { windowsHide: true, timeout: 120_000 })
		} catch {}
	}
	await close(server)
	rmSync(temp, { recursive: true, force: true })
}
