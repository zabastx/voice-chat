import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

const root = join(import.meta.dirname, '..')
const exe = join(import.meta.dirname, 'src-tauri', 'target', 'release', 'voice-chat.exe')
const temp = mkdtempSync(join(tmpdir(), 'voice-chat-shell-'))
const pfx = join(temp, 'localhost.pfx')
const pfxPassword = randomUUID()
const debugPort = 9341
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))
const powershell = (command, env = {}) =>
	execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
		encoding: 'utf8',
		env: { ...process.env, ...env }
	}).trim()
const listen = (server, port = 0) =>
	new Promise((resolve, reject) => {
		server.once('error', reject)
		server.listen(port, '127.0.0.1', resolve)
	})
const close = (server) =>
	new Promise((resolve) => {
		if (!server?.listening) return resolve()
		server.close(resolve)
	})
const waitFor = async (predicate, label) => {
	for (let attempt = 0; attempt < 60; attempt += 1) {
		if (await predicate()) return
		await sleep(125)
	}
	throw new Error(`Timed out waiting for ${label}`)
}

let browser
let child
let certificateThumbprint = ''
let overrideServer
let brokenProductionServer
let productionServer

try {
	const running = powershell(
		"@(Get-Process -Name 'voice-chat' -ErrorAction SilentlyContinue).Count"
	)
	if (running !== '0') throw new Error('Close Voice Chat before running the desktop shell check')

	certificateThumbprint = powershell(
		[
			"$certificate = New-SelfSignedCertificate -Subject 'CN=Voice Chat shell test' -DnsName 'localhost' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(1)",
			'$password = ConvertTo-SecureString -String $env:VC_PFX_PASSWORD -AsPlainText -Force',
			'Export-PfxCertificate -Cert $certificate -FilePath $env:VC_PFX -Password $password | Out-Null',
			'$certificate.Thumbprint'
		].join('; '),
		{ VC_PFX: pfx, VC_PFX_PASSWORD: pfxPassword }
	)

	const productionPort = Number(process.env.VOICECHAT_DESKTOP_CHECK_PORT ?? '39417')
	const reservation = createNetServer()
	await listen(reservation, productionPort)
	await close(reservation)
	const productionOrigin = `https://127.0.0.1:${productionPort}`

	console.log(
		`Building production shell for local HTTPS acceptance origin on port ${productionPort}`
	)
	execFileSync('bun', ['scripts/desktop.ts', 'compile'], {
		cwd: root,
		stdio: 'inherit',
		env: { ...process.env, VOICECHAT_DESKTOP_PRODUCTION_ORIGIN: productionOrigin }
	})
	if (!existsSync(exe)) throw new Error(`Release executable is missing: ${exe}`)
	const version = JSON.parse(
		powershell(
			'$item = Get-Item -LiteralPath $env:VC_EXE; $item.VersionInfo | Select-Object ProductName,ProductVersion | ConvertTo-Json -Compress',
			{ VC_EXE: exe }
		)
	)
	if (version.ProductName !== 'Voice Chat' || version.ProductVersion !== '0.1.0-alpha.1') {
		throw new Error(`Unexpected desktop identity: ${JSON.stringify(version)}`)
	}
	console.log('PASS identity: Voice Chat 0.1.0-alpha.1 in voice-chat.exe')

	overrideServer = createHttpServer((_request, response) => {
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		response.end(
			'<!doctype html><title>runtime override</title><p id="runtime-override">unsafe</p>'
		)
	})
	await listen(overrideServer)
	const overridePort = overrideServer.address().port
	productionServer = createHttpsServer(
		{ pfx: readFileSync(pfx), passphrase: pfxPassword },
		(_request, response) => {
			response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
			response.end(
				'<!doctype html><title>Voice Chat test</title><p id="production-app">connected</p><a id="server-stopped" href="/server-stopped">check stopped server</a>'
			)
		}
	)
	brokenProductionServer = createNetServer((socket) => socket.destroy())
	await listen(brokenProductionServer, productionPort)

	child = spawn(exe, [], {
		windowsHide: true,
		stdio: 'ignore',
		env: {
			...process.env,
			VOICECHAT_DESKTOP_URL: `http://127.0.0.1:${overridePort}`,
			WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --ignore-certificate-errors`
		}
	})

	for (let attempt = 0; attempt < 40; attempt += 1) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
			break
		} catch {
			await sleep(250)
		}
	}
	if (!browser) throw new Error('Voice Chat did not expose its test CDP endpoint')
	const [context] = browser.contexts()
	const [page] = context.pages()
	await page.getByRole('button', { name: 'Повторить' }).waitFor({ timeout: 5000 })
	await page.getByRole('button', { name: 'Выйти' }).waitFor({ timeout: 5000 })
	if (await page.locator('#runtime-override').count()) {
		throw new Error('Release executable accepted VOICECHAT_DESKTOP_URL at runtime')
	}
	console.log('PASS origin: release ignores runtime override and shows the local Russian screen')
	console.log('PASS recovery: an open TCP port with broken TLS falls back to the local screen')

	await close(brokenProductionServer)
	await listen(productionServer, productionPort)
	await page.getByRole('button', { name: 'Повторить' }).click()
	await page.locator('#production-app').waitFor({ timeout: 10_000 })
	if (!page.url().startsWith(productionOrigin)) {
		throw new Error(`Recovery navigated to an unexpected origin: ${page.url()}`)
	}
	console.log('PASS recovery: retry loads the embedded HTTPS origin without restarting')

	// The Native Bridge (#6) runs the same contract scenarios as `bun test`, here against the
	// object the release shell actually froze onto the remote page.
	const contractBundle = join(temp, 'native-bridge-contract.js')
	execFileSync(
		'bun',
		[
			'build',
			join(root, 'test', 'native-bridge-contract.browser.ts'),
			'--target=browser',
			'--outfile',
			contractBundle
		],
		{ cwd: root, stdio: 'inherit' }
	)
	await page.evaluate(
		(source) => {
			new Function(source)()
		},
		readFileSync(contractBundle, 'utf8')
	)

	const descriptor = await page.evaluate(() => {
		const value = globalThis.voiceChatDesktop
		if (!value) return null
		return {
			desktopVersion: value.desktopVersion,
			bridgeVersion: value.bridgeVersion,
			capabilities: [...value.capabilities],
			operations: Object.keys(value).filter((key) => typeof value[key] === 'function'),
			frozen: Object.isFrozen(value)
		}
	})
	if (
		descriptor?.desktopVersion !== version.ProductVersion ||
		descriptor.bridgeVersion !== 1 ||
		descriptor.frozen !== true ||
		descriptor.capabilities.join(',') !== 'voice-lifecycle' ||
		descriptor.operations.join(',') !== 'setVoiceActive'
	) {
		throw new Error(`Unexpected Native Bridge descriptor: ${JSON.stringify(descriptor)}`)
	}
	console.log(
		`PASS bridge: the remote page sees a frozen desktop ${version.ProductVersion} / bridge 1 descriptor`
	)

	const contract = await page.evaluate(() =>
		globalThis.__voiceChatBridgeContract(globalThis.voiceChatDesktop, { desktop: true })
	)
	const failedScenarios = contract.filter((result) => !result.passed)
	if (failedScenarios.length > 0 || contract.length === 0) {
		throw new Error(
			`Native Bridge contract failed against the real adapter: ${JSON.stringify(failedScenarios)}`
		)
	}
	console.log(
		`PASS bridge: ${contract.length} contract scenarios pass against the real Tauri adapter`
	)

	const authority = await page.evaluate(async () => {
		const report = { invoke: 'unavailable', globals: [] }
		for (const name of ['__TAURI__', '__TAURI_INTERNALS__', '__TAURI_EVENT_PLUGIN_INTERNALS__']) {
			if (name in globalThis) report.globals.push(name)
		}
		const invoke = globalThis.__TAURI_INTERNALS__?.invoke
		if (typeof invoke === 'function') {
			// If the boundary held, this rejects; if it resolved it would open a browser tab,
			// which is exactly the failure this check exists to catch.
			report.invoke = await invoke('plugin:opener|open_url', { url: 'https://example.invalid' })
				.then(() => 'resolved')
				.catch(() => 'rejected')
		}
		return report
	})
	if (authority.invoke === 'resolved') {
		throw new Error('Remote origin reached a Tauri plugin command through invoke')
	}
	console.log(
		`PASS bridge: remote origin has no usable Tauri invoke (globals: ${authority.globals.join(', ') || 'none'}, invoke: ${authority.invoke})`
	)

	// The reverse operation, then the same guard reached by a page that skips the injected
	// descriptor and writes the URL itself. One navigation per evaluate: assigning
	// `location.href` twice in a synchronous block only performs the last one.
	await page.evaluate(() => globalThis.voiceChatDesktop.setVoiceActive(true))
	for (const forged of [
		// The shape an embed that navigated the top frame can produce: right operation,
		// no token.
		'voicechat://bridge/setVoiceActive?value=0',
		'voicechat://bridge/installUpdate?value=1',
		'voicechat://bridge/setVoiceActive?value=yes',
		'voicechat://bridge/openLogFolder?value=1'
	]) {
		await page.evaluate((url) => {
			location.href = url
		}, forged)
		await sleep(50)
	}
	if ((await page.locator('#production-app').count()) !== 1) {
		throw new Error('A Native Bridge navigation replaced the remote document')
	}
	await page.evaluate(() => {
		location.href = 'voicechat://exit'
	})
	await sleep(250)
	if (child.exitCode !== null || (await page.locator('#production-app').count()) !== 1) {
		throw new Error('Remote content crossed the native shell command boundary')
	}
	console.log('PASS boundary: remote content cannot invoke native shell commands')

	productionServer.closeAllConnections?.()
	await close(productionServer)
	await page.evaluate(() => document.querySelector('#server-stopped')?.click())
	await waitFor(
		async () =>
			page.url() === 'http://tauri.localhost/index.html' &&
			(await page.locator('#connection-error').count()) === 1,
		'local screen after a later failed navigation'
	)
	if (await page.evaluate(() => 'voiceChatDesktop' in globalThis)) {
		throw new Error('The bundled error screen received the Native Bridge')
	}
	console.log('PASS bridge: only the trusted origin receives the descriptor')
	await listen(productionServer, productionPort)
	await page.evaluate(() => document.querySelector('button')?.click())
	await page.locator('#production-app').waitFor({ timeout: 10_000 })
	console.log('PASS recovery: a later failed navigation returns to the local screen')

	const processState = () =>
		JSON.parse(
			powershell(
				`Get-Process -Id ${child.pid} | Select-Object Id,MainWindowHandle,MainWindowTitle | ConvertTo-Json -Compress`
			)
		)
	const isHidden = () => processState().MainWindowTitle.endsWith('-siw')
	await waitFor(() => !isHidden(), 'initial window')
	powershell(`(Get-Process -Id ${child.pid}).CloseMainWindow()`)
	await waitFor(isHidden, 'close-to-tray')
	execFileSync(exe, [], { windowsHide: true })
	await waitFor(() => !isHidden(), 'single-instance restore')
	const count = powershell("@(Get-Process -Name 'voice-chat' -ErrorAction SilentlyContinue).Count")
	if (count !== '1') throw new Error(`Expected one Voice Chat process, found ${count}`)
	execFileSync(exe, ['--tray'], { windowsHide: true })
	await waitFor(isHidden, 'tray hide')
	execFileSync(exe, [], { windowsHide: true })
	await waitFor(() => !isHidden(), 'second restore')
	console.log('PASS lifecycle: close, hide, restore and single instance')

	execFileSync(exe, ['--exit'], { windowsHide: true })
	await waitFor(() => child.exitCode !== null, 'explicit exit')
	console.log('PASS lifecycle: explicit exit stops the process')

	const logDirectory = join(process.env.LOCALAPPDATA, 'ru.zabastx.voicechat', 'logs')
	const logs = readdirSync(logDirectory)
		.filter((name) => name.endsWith('.log'))
		.map((name) => join(logDirectory, name))
	if (logs.length === 0 || logs.length > 3) {
		throw new Error(`Expected 1-3 bounded log files, found ${logs.length}`)
	}
	let recorded = ''
	for (const log of logs) {
		if (statSync(log).size > 256 * 1024) throw new Error(`Oversized desktop log: ${log}`)
		const contents = readFileSync(log, 'utf8')
		if (/cookie|session|https?:\/\//i.test(contents)) {
			throw new Error(`Desktop log contains secret-bearing data: ${log}`)
		}
		recorded += contents
	}
	console.log('PASS diagnostics: local logs are bounded and contain no URLs or session material')

	if (!recorded.includes('voice channel active') || !recorded.includes('voice channel idle')) {
		throw new Error('The shell never observed the voice lifecycle signal')
	}
	if (!recorded.includes('native bridge message rejected')) {
		throw new Error('The shell accepted a forged Native Bridge message')
	}
	console.log('PASS bridge: the shell applied setVoiceActive and refused every forged envelope')
} finally {
	await browser?.close().catch(() => {})
	if (child?.exitCode === null) child.kill()
	await close(overrideServer)
	await close(brokenProductionServer)
	await close(productionServer)
	if (certificateThumbprint) {
		powershell(
			"Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $env:VC_CERT_THUMBPRINT) -ErrorAction SilentlyContinue",
			{ VC_CERT_THUMBPRINT: certificateThumbprint }
		)
	}
	if (temp.startsWith(tmpdir())) rmSync(temp, { recursive: true, force: true })
}
