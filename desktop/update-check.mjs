import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { desktopReleaseArtifacts } from '../scripts/desktop-artifacts.ts'

const root = join(import.meta.dirname, '..')
const tauriRoot = join(import.meta.dirname, 'src-tauri')
const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8'))
const names = desktopReleaseArtifacts(config.version)
const builtPortable = join(tauriRoot, 'target', 'release', 'bundle', 'nsis', names.portable)
const fixturePath = join(root, 'test', 'fixtures', 'desktop-portable-update.json')
const temp = mkdtempSync(join(tmpdir(), 'voice-chat-portable-update-'))
const portable = join(temp, 'Voice Chat portable update check.exe')
const localAppData = process.env.LOCALAPPDATA
if (!localAppData) throw new Error('LOCALAPPDATA is required')
const installDirectory = join(localAppData, 'Voice Chat')
const uninstaller = join(installDirectory, 'uninstall.exe')
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
const waitFor = async (predicate, label, attempts = 120) => {
	for (let attempt = 0; attempt < attempts; attempt += 1) {
		if (await predicate()) return
		await sleep(125)
	}
	throw new Error(`Timed out waiting for ${label}`)
}
const powershell = (command, env = {}, stdio = 'pipe') =>
	execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
		encoding: 'utf8',
		stdio,
		env: { ...process.env, ...env }
	})?.trim()
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

function findDialogButton(label, click = false) {
	try {
		powershell(
			[
				'Add-Type -AssemblyName UIAutomationClient',
				'$root = [System.Windows.Automation.AutomationElement]::RootElement',
				'$title = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $env:VC_DIALOG_TITLE)',
				'$dialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $title)',
				'if ($null -eq $dialog) { exit 2 }',
				'$name = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $env:VC_BUTTON)',
				'$button = $dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $name)',
				'if ($null -eq $button) { exit 3 }',
				'if ($env:VC_CLICK -eq "1") {',
				'  try {',
				'    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()',
				'  } catch {',
				'    try { $button.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern).DoDefaultAction() } catch { exit 5 }',
				'  }',
				'}',
				'exit 0'
			].join('; '),
			{
				VC_DIALOG_TITLE: 'Обновление Voice Chat',
				VC_BUTTON: label,
				VC_CLICK: click ? '1' : '0'
			},
			'ignore'
		)
		return true
	} catch {
		return false
	}
}

async function stop(child) {
	if (!child || child.exitCode !== null) return
	execFileSync(portable, ['--exit'])
	await waitFor(() => child.exitCode !== null, 'Portable EXE exit')
}

if (existsSync(installDirectory) || existsSync(uninstaller)) {
	throw new Error('Portable update check requires Voice Chat to be uninstalled')
}

let server
let child
try {
	const requestedPort = Number(process.env.VOICECHAT_DESKTOP_UPDATE_CHECK_PORT ?? '0')
	const reservation = createNetServer()
	await listen(reservation, requestedPort)
	const port = reservation.address().port
	await close(reservation)
	const origin = `http://localhost:${port}`
	const fixture = JSON.parse(
		readFileSync(fixturePath, 'utf8')
			.replaceAll('{{origin}}', origin)
			.replaceAll('{{run}}', randomUUID())
	)
	let feedRequests = 0
	let releaseRequests = 0
	const feedQueries = []
	server = createHttpServer((request, response) => {
		const url = new URL(request.url, origin)
		if (url.pathname === '/api/desktop/update') {
			feedRequests += 1
			feedQueries.push(Object.fromEntries(url.searchParams))
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(JSON.stringify(fixture))
			return
		}
		if (url.pathname === '/releases/tag/desktop-v0.1.0-alpha.2') {
			releaseRequests += 1
			response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
			response.end('<!doctype html><title>Fixture Desktop Release</title>')
			return
		}
		response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
		response.end('<!doctype html><title>Voice Chat update check</title><main>ready</main>')
	})
	await listen(server, port)

	if (process.env.VOICECHAT_DESKTOP_SKIP_BUILD !== '1') {
		console.log('Building Portable EXE against the fixture update feed')
		execFileSync('bun', ['scripts/desktop.ts', 'build'], {
			cwd: root,
			stdio: 'inherit',
			env: {
				...process.env,
				VOICECHAT_DESKTOP_PRODUCTION_ORIGIN: origin,
				VOICECHAT_DESKTOP_UPDATE_CHECK: '1'
			}
		})
	}
	if (!existsSync(builtPortable)) throw new Error('Portable release artifact is missing')
	copyFileSync(builtPortable, portable)
	const originalHash = hash(portable)

	child = spawn(portable, [], { stdio: 'ignore' })
	await waitFor(() => feedRequests === 1, 'startup update check')
	await waitFor(() => findDialogButton('Открыть выпуск'), 'Russian accept button')
	await waitFor(() => findDialogButton('Отложить'), 'Russian postpone button')
	await sleep(500)
	if (releaseRequests !== 0) throw new Error('Update opened without member consent')
	findDialogButton('Отложить', true)
	await waitFor(() => !findDialogButton('Отложить'), 'postpone choice to close the update prompt')
	if (releaseRequests !== 0) throw new Error('Postponing an update opened its Release page')
	if (child.exitCode !== null) throw new Error('Postponing stopped the Portable EXE')
	console.log('PASS update: postponed offer stays in the Portable EXE')
	await stop(child)

	child = spawn(portable, [], { stdio: 'ignore' })
	await waitFor(() => feedRequests === 2, 'second startup update check')
	await waitFor(() => findDialogButton('Открыть выпуск'), 'Russian accept button')
	await waitFor(() => findDialogButton('Отложить'), 'Russian postpone button')
	findDialogButton('Открыть выпуск', true)
	await waitFor(() => releaseRequests > 0, 'exact fixture Release page in the system browser', 240)

	if (
		feedQueries.some(
			(query) =>
				query.target !== 'windows' || query.arch !== 'x86_64' || query.version !== config.version
		)
	) {
		throw new Error(`Unexpected update query: ${JSON.stringify(feedQueries)}`)
	}
	if (child.exitCode !== null) throw new Error('Opening a release stopped the Portable EXE')
	if (hash(portable) !== originalHash) throw new Error('Portable EXE replaced its running file')
	if (existsSync(installDirectory) || existsSync(uninstaller)) {
		throw new Error('Portable update path started an installation')
	}
	console.log('PASS update: accepted offer opens the exact fixture Release page')
	console.log('PASS portable: EXE stays running and performs no install or self-replacement')
} finally {
	await stop(child).catch(() => child?.kill())
	await close(server)
	rmSync(temp, { recursive: true, force: true })
}
