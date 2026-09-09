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
	execFileSync('bun', ['scripts/desktop.ts', 'build'], {
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
	for (const log of logs) {
		if (statSync(log).size > 256 * 1024) throw new Error(`Oversized desktop log: ${log}`)
		const contents = readFileSync(log, 'utf8')
		if (/cookie|session|https?:\/\//i.test(contents)) {
			throw new Error(`Desktop log contains secret-bearing data: ${log}`)
		}
	}
	console.log('PASS diagnostics: local logs are bounded and contain no URLs or session material')
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
