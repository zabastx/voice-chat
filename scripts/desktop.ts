// Nuxt remains on the server; this process only builds or launches the desktop shell.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const root = join(import.meta.dirname, '..')
const desktop = join(root, 'desktop')
const action = process.argv[2] ?? 'run'
if (!['dev', 'build', 'run'].includes(action)) throw new Error('Ожидается dev, build или run')

const env = { ...process.env }
const localCargo = join(root, '.data', 'tooling', 'cargo')
if (!env.CARGO_HOME && existsSync(join(localCargo, 'bin', 'cargo.exe'))) {
	env.CARGO_HOME = localCargo
	env.RUSTUP_HOME = join(root, '.data', 'tooling', 'rustup')
	env.PATH = `${join(localCargo, 'bin')}${delimiter}${env.PATH ?? ''}`
}

if (action === 'dev') {
	const url = new URL(env.VOICECHAT_DESKTOP_URL ?? 'http://localhost:3000')
	const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	if (
		!(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	)
		throw new Error('Debug origin должен использовать HTTPS или loopback HTTP')
	env.VOICECHAT_DESKTOP_URL = url.origin
}

if (action === 'build') {
	const configured =
		env.VOICECHAT_DESKTOP_PRODUCTION_ORIGIN ?? (env.DOMAIN ? `https://${env.DOMAIN}` : '')
	if (!configured) {
		throw new Error('Задайте VOICECHAT_DESKTOP_PRODUCTION_ORIGIN или DOMAIN для release-сборки')
	}
	const url = new URL(configured)
	if (
		url.protocol !== 'https:' ||
		url.username ||
		url.password ||
		url.pathname !== '/' ||
		url.search ||
		url.hash
	) {
		throw new Error('Production origin должен быть корневым HTTPS origin без credentials')
	}
	env.VOICECHAT_DESKTOP_PRODUCTION_ORIGIN = url.origin
}

const exe = join(desktop, 'src-tauri', 'target', 'release', 'voice-chat.exe')
let result
if (action === 'run') {
	if (!existsSync(exe)) throw new Error('Сначала выполните bun run desktop:build')
	result = spawnSync(exe, process.argv.slice(3), { cwd: root, env, stdio: 'inherit' })
} else {
	const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
	result = spawnSync(
		process.execPath,
		[cli, action, ...(action === 'build' ? ['--no-bundle'] : [])],
		{
			cwd: desktop,
			env,
			stdio: 'inherit'
		}
	)
}
if (result.error) throw result.error
process.exitCode = result.status ?? 1
