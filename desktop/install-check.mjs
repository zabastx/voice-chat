import { execFileSync, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpsServer } from 'node:https'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chromium } from 'playwright-core'

import { desktopReleaseArtifacts } from '../scripts/desktop-artifacts.ts'

const root = join(import.meta.dirname, '..')
const tauriRoot = join(import.meta.dirname, 'src-tauri')
const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8'))
const names = desktopReleaseArtifacts(config.version)
const bundleDirectory = join(tauriRoot, 'target', 'release', 'bundle', 'nsis')
const setup = join(bundleDirectory, names.setup)
const portable = join(bundleDirectory, names.portable)
const localAppData = process.env.LOCALAPPDATA
const roamingAppData = process.env.APPDATA
if (!localAppData || !roamingAppData) throw new Error('Windows app-data paths are unavailable')

const installDirectory = join(localAppData, 'Voice Chat')
const installed = join(installDirectory, 'voice-chat.exe')
const uninstaller = join(installDirectory, 'uninstall.exe')
const localProfile = join(localAppData, config.identifier)
const roamingProfile = join(roamingAppData, config.identifier)
const sessionCookie = `voice-chat-install-check=${randomUUID()}`
const preferenceValue = JSON.stringify({ outputDeviceId: 'install-check-speakers' })
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

const waitFor = async (predicate, label, attempts = 80) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (await predicate()) return
		await sleep(125)
	}
	throw new Error(`Timed out waiting for ${label}`)
}

function webviewRuntimeVersion() {
	return powershell(
		[
			"$paths = @('HKLM:\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKLM:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'HKCU:\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}')",
			'foreach ($path in $paths) {',
			"  $version = (Get-ItemProperty -LiteralPath $path -Name 'pv' -ErrorAction SilentlyContinue).pv",
			'  if ($version) { $version; exit 0 }',
			'}'
		].join('; ')
	)
}

function windowIsVisible(pid) {
	return powershell(`(Get-Process -Id ${pid}).MainWindowTitle -notlike '*-siw'`) === 'True'
}

function candidateProcessCount() {
	return Number(
		powershell(
			'@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -in @($env:VC_INSTALLED, $env:VC_PORTABLE) }).Count',
			{ VC_INSTALLED: installed, VC_PORTABLE: portable }
		)
	)
}

async function launch(executable, debugPort) {
	const child = spawn(executable, [], {
		windowsHide: true,
		stdio: 'ignore',
		env: {
			...process.env,
			WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --ignore-certificate-errors`
		}
	})
	let browser
	for (let attempt = 0; attempt < 60; attempt += 1) {
		try {
			browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
			break
		} catch {
			if (child.exitCode !== null) throw new Error(`${executable} exited before WebView2 started`)
			await sleep(250)
		}
	}
	if (!browser) throw new Error(`${executable} did not expose its test CDP endpoint`)
	const [context] = browser.contexts()
	const [page] = context.pages()
	await page.locator('#install-check').waitFor({ timeout: 10_000 })
	return { browser, child, page }
}

if (process.platform !== 'win32' || process.arch !== 'x64') {
	throw new Error('The clean install check requires Windows x64')
}

for (const path of [installDirectory, localProfile, roamingProfile]) {
	if (existsSync(path)) {
		throw new Error(`Refusing to touch an existing Voice Chat installation or profile: ${path}`)
	}
}
if (candidateProcessCount() !== 0)
	throw new Error('Close Voice Chat before the clean install check')

const temp = mkdtempSync(join(tmpdir(), 'voice-chat-install-'))
const pfx = join(temp, 'localhost.pfx')
const certificateFile = join(temp, 'localhost.cer')
const pfxPassword = randomUUID()
let activeClient
let certificateThumbprint = ''
let server
try {
	certificateThumbprint = powershell(
		[
			"$certificate = New-SelfSignedCertificate -Subject 'CN=Voice Chat install test' -DnsName 'localhost' -CertStoreLocation 'Cert:\\CurrentUser\\My' -KeyExportPolicy Exportable -NotAfter (Get-Date).AddDays(1)",
			'$password = ConvertTo-SecureString -String $env:VC_PFX_PASSWORD -AsPlainText -Force',
			'Export-PfxCertificate -Cert $certificate -FilePath $env:VC_PFX -Password $password | Out-Null',
			'Export-Certificate -Cert $certificate -FilePath $env:VC_CERTIFICATE | Out-Null',
			"Import-Certificate -FilePath $env:VC_CERTIFICATE -CertStoreLocation 'Cert:\\CurrentUser\\Root' | Out-Null",
			'$certificate.Thumbprint'
		].join('; '),
		{ VC_CERTIFICATE: certificateFile, VC_PFX: pfx, VC_PFX_PASSWORD: pfxPassword }
	)

	const port = Number(process.env.VOICECHAT_DESKTOP_INSTALL_CHECK_PORT ?? '39418')
	const reservation = createNetServer()
	await listen(reservation, port)
	await close(reservation)
	const origin = `https://localhost:${port}`
	server = createHttpsServer(
		{ pfx: readFileSync(pfx), passphrase: pfxPassword },
		(request, response) => {
			const signedIn = request.headers.cookie?.split('; ').includes(sessionCookie) === true
			response.writeHead(200, {
				'content-type': 'text/html; charset=utf-8',
				...(signedIn
					? {}
					: {
							'set-cookie': `${sessionCookie}; Max-Age=3600; HttpOnly; Secure; SameSite=Strict; Path=/`
						})
			})
			response.end(
				`<!doctype html><title>Voice Chat install check</title><main id="install-check" data-signed-in="${signedIn}">ready</main>`
			)
		}
	)
	await listen(server, port)

	const runtimeBefore = webviewRuntimeVersion()
	if (process.env.VOICECHAT_DESKTOP_SKIP_BUILD !== '1') {
		execFileSync('bun', ['scripts/desktop.ts', 'build'], {
			cwd: root,
			stdio: 'inherit',
			env: { ...process.env, VOICECHAT_DESKTOP_PRODUCTION_ORIGIN: origin }
		})
	}
	if (!existsSync(setup) || !existsSync(portable)) {
		throw new Error('Release build did not create both NSIS and Portable artifacts')
	}

	execFileSync(setup, ['/S'], { windowsHide: true, timeout: 60_000 })
	if (!existsSync(installed) || !existsSync(uninstaller)) {
		throw new Error('Per-user NSIS install did not create the application and uninstaller')
	}
	console.log('PASS install: per-user NSIS installed Voice Chat without elevation')

	activeClient = await launch(installed, 9342)
	await activeClient.page.evaluate(
		(value) => localStorage.setItem('voice-chat:prefs', value),
		preferenceValue
	)
	await activeClient.page.reload({ waitUntil: 'domcontentloaded' })
	if (
		(await activeClient.page.locator('#install-check').getAttribute('data-signed-in')) !== 'true'
	) {
		throw new Error('Installed client did not persist its Sign-in cookie')
	}
	execFileSync(installed, ['--exit'], { windowsHide: true })
	await waitFor(() => activeClient.child.exitCode !== null, 'installed client exit')
	await activeClient.browser.close()
	activeClient = undefined

	activeClient = await launch(portable, 9343)
	const sharedState = await activeClient.page.evaluate(() => ({
		signedIn: document.querySelector('#install-check')?.getAttribute('data-signed-in'),
		preferences: localStorage.getItem('voice-chat:prefs')
	}))
	if (sharedState.signedIn !== 'true' || sharedState.preferences !== preferenceValue) {
		throw new Error(`Portable client did not reuse installed state: ${JSON.stringify(sharedState)}`)
	}
	console.log('PASS profile: installed and Portable clients share Sign-in and settings')

	powershell(`(Get-Process -Id ${activeClient.child.pid}).CloseMainWindow() | Out-Null`)
	await waitFor(() => !windowIsVisible(activeClient.child.pid), 'Portable window hidden in tray')
	execFileSync(installed, [], { windowsHide: true })
	await waitFor(
		() => windowIsVisible(activeClient.child.pid),
		'installed launch restoring Portable'
	)
	if (candidateProcessCount() !== 1)
		throw new Error('Installed and Portable clients did not share one instance')
	console.log('PASS instance: installed launch restores the running Portable client')

	if (!existsSync(localProfile)) throw new Error('The shared LOCALAPPDATA profile was not created')
	execFileSync(uninstaller, ['/S'], { windowsHide: true, timeout: 60_000 })
	await waitFor(
		() => activeClient.child.exitCode !== null,
		'Portable client exit through the uninstaller'
	)
	await activeClient.browser.close().catch(() => {})
	activeClient = undefined
	if (candidateProcessCount() !== 0)
		throw new Error('Uninstaller left an installed or Portable client running')
	await waitFor(
		() => !existsSync(installDirectory) && !existsSync(localProfile) && !existsSync(roamingProfile),
		'application and shared profile removal'
	)

	execFileSync(setup, ['/S'], { windowsHide: true, timeout: 60_000 })
	if (!existsSync(uninstaller))
		throw new Error('Second NSIS install did not create the uninstaller')
	if (candidateProcessCount() !== 0)
		throw new Error('Silent install unexpectedly launched a client')
	execFileSync(uninstaller, ['/S'], { windowsHide: true, timeout: 60_000 })
	await waitFor(
		() => !existsSync(installDirectory) && !existsSync(localProfile) && !existsSync(roamingProfile),
		'stopped-client uninstall cleanup'
	)
	console.log('PASS uninstall: completes with both a running Portable and no running client')
	if (!webviewRuntimeVersion())
		throw new Error('NSIS uninstall removed the system WebView2 Runtime')
	console.log(
		`PASS uninstall: application and shared profile removed; WebView2 remains ${runtimeBefore || 'installed'}`
	)
} finally {
	await activeClient?.browser?.close().catch(() => {})
	if (activeClient?.child?.exitCode === null) activeClient.child.kill()
	if (existsSync(uninstaller)) {
		try {
			execFileSync(uninstaller, ['/S'], { windowsHide: true, timeout: 60_000 })
		} catch {}
	}
	await close(server)
	if (certificateThumbprint) {
		powershell(
			"Remove-Item -LiteralPath ('Cert:\\CurrentUser\\My\\' + $env:VC_CERT_THUMBPRINT), ('Cert:\\CurrentUser\\Root\\' + $env:VC_CERT_THUMBPRINT) -ErrorAction SilentlyContinue",
			{ VC_CERT_THUMBPRINT: certificateThumbprint }
		)
	}
	if (temp.startsWith(tmpdir())) rmSync(temp, { recursive: true, force: true })
}
