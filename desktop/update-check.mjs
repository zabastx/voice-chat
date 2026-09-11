import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { desktopReleaseArtifacts } from '../scripts/desktop-artifacts.ts'
import { generateUpdaterKey } from '../scripts/desktop-signing.ts'
import { expectOffer, offerMessage, OPEN_RELEASE, POSTPONE, readOffer } from './update-dialog.mjs'

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
const desktopLog = join(localAppData, config.identifier, 'logs', 'voice-chat.log')

const QUESTION = 'Открыть страницу выпуска, чтобы скачать и вручную заменить Portable EXE?'

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
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const logEventCount = (event) =>
	existsSync(desktopLog) ? readFileSync(desktopLog, 'utf8').split(event).length - 1 : 0

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
	const releasePath = new URL(fixture.release_url).pathname
	// what the feed answers next: the newer Release, the running one, or an outage
	let feed = 'offer'
	let feedRequests = 0
	let pageRequests = 0
	const releaseRequests = []
	const feedQueries = []
	server = createHttpServer((request, response) => {
		const url = new URL(request.url, origin)
		if (url.pathname === '/api/desktop/update') {
			feedRequests += 1
			feedQueries.push(Object.fromEntries(url.searchParams))
			if (feed === 'down') {
				response.writeHead(503, { 'content-type': 'text/plain' })
				response.end('fixture feed is down')
				return
			}
			response.writeHead(200, { 'content-type': 'application/json' })
			response.end(
				JSON.stringify(feed === 'offer' ? fixture : { ...fixture, version: config.version })
			)
			return
		}
		if (url.pathname === releasePath) {
			releaseRequests.push(url.href)
			response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
			response.end('<!doctype html><title>Fixture Desktop Release</title>')
			return
		}
		pageRequests += 1
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
				VOICECHAT_DESKTOP_UPDATE_CHECK: '1',
				VOICECHAT_DESKTOP_UPDATER_PUBKEY: generateUpdaterKey(temp).publicKey
			}
		})
	}
	if (!existsSync(builtPortable)) throw new Error('Portable release artifact is missing')
	copyFileSync(builtPortable, portable)
	const originalHash = hash(portable)

	let postponed = logEventCount('desktop update postponed')
	child = spawn(portable, [], { stdio: 'ignore' })
	await waitFor(() => feedRequests === 1, 'startup update check')
	const declined = readOffer({ click: POSTPONE })
	expectOffer(declined, {
		message: offerMessage(fixture.version, fixture.notes, QUESTION),
		accept: OPEN_RELEASE
	})
	if (declined.clicked !== POSTPONE) throw new Error(`Could not press «${POSTPONE}»`)
	await waitFor(
		() => logEventCount('desktop update postponed') > postponed,
		'the postponed offer in the local desktop log'
	)
	if (releaseRequests.length !== 0) throw new Error('Postponing an update opened its Release page')
	if (child.exitCode !== null) throw new Error('Postponing stopped the Portable EXE')
	console.log('PASS update: postponed offer stays in the Portable EXE')
	await stop(child)

	child = spawn(portable, [], { stdio: 'ignore' })
	await waitFor(() => feedRequests === 2, 'second startup update check')
	const accepted = readOffer({ click: OPEN_RELEASE })
	expectOffer(accepted, {
		message: offerMessage(fixture.version, fixture.notes, QUESTION),
		accept: OPEN_RELEASE
	})
	if (accepted.clicked !== OPEN_RELEASE) throw new Error(`Could not press «${OPEN_RELEASE}»`)
	await waitFor(
		() => releaseRequests.length > 0,
		'exact fixture Release page in the system browser',
		240
	)
	const expectedReleaseUrl = new URL(fixture.release_url).href
	if (releaseRequests.length !== 1 || releaseRequests[0] !== expectedReleaseUrl) {
		throw new Error(
			`Opened ${JSON.stringify(releaseRequests)} instead of ${JSON.stringify(expectedReleaseUrl)}`
		)
	}
	if (child.exitCode !== null) throw new Error('Opening a release stopped the Portable EXE')
	if (hash(portable) !== originalHash) throw new Error('Portable EXE replaced its running file')
	if (existsSync(installDirectory) || existsSync(uninstaller)) {
		throw new Error('Portable update path started an installation')
	}
	console.log('PASS update: accepted offer opens the exact fixture Release page')
	console.log('PASS portable: EXE stays running and performs no install or self-replacement')
	await stop(child)

	feed = 'running'
	postponed = logEventCount('desktop update postponed')
	const opened = logEventCount('desktop update release opened')
	child = spawn(portable, [], { stdio: 'ignore' })
	await waitFor(() => feedRequests === 3, 'update check against the running version')
	const offeredItself = readOffer({ timeout: 5000 })
	if (offeredItself.found) {
		throw new Error(`The running version was offered as an update: ${offeredItself.text}`)
	}
	if (releaseRequests.length !== 1) throw new Error('The running version opened a Release page')
	if (logEventCount('desktop update postponed') !== postponed) {
		throw new Error('The running version produced an offer to postpone')
	}
	if (logEventCount('desktop update release opened') !== opened) {
		throw new Error('The running version opened a Release')
	}
	console.log('PASS update: the running version is never offered as an update')
	await stop(child)

	feed = 'down'
	const failures = logEventCount('desktop update check failed')
	const pagesBefore = pageRequests
	child = spawn(portable, [], { stdio: 'ignore' })
	await waitFor(() => feedRequests === 4, 'update check against a failing feed')
	await waitFor(
		() => logEventCount('desktop update check failed') > failures,
		'the failed update check in the local desktop log'
	)
	const outage = readOffer({ timeout: 3000 })
	if (outage.found) throw new Error('A failing feed produced an update offer')
	await waitFor(
		() => pageRequests > pagesBefore,
		'the Web Release loading despite the failed check'
	)
	if (child.exitCode !== null) throw new Error('A failed update check stopped the Portable EXE')
	console.log('PASS update: a failing feed stays a local diagnostic')

	if (
		feedQueries.some(
			(query) =>
				query.target !== 'windows' || query.arch !== 'x86_64' || query.version !== config.version
		)
	) {
		throw new Error(`Unexpected update query: ${JSON.stringify(feedQueries)}`)
	}
	if (hash(portable) !== originalHash) throw new Error('Portable EXE replaced its running file')
	if (existsSync(installDirectory) || existsSync(uninstaller)) {
		throw new Error('Portable update path started an installation')
	}
} finally {
	await stop(child).catch(() => child?.kill())
	await close(server)
	rmSync(temp, { recursive: true, force: true })
}
