// Prototype runner. Nuxt remains on the server; this process only builds/launches the shell.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const root = join(import.meta.dirname, '..')
const desktop = join(root, 'desktop-prototype')
const action = process.argv[2] ?? 'run'
if (!['dev', 'build', 'run'].includes(action)) throw new Error('Ожидается dev, build или run')

const env = { ...process.env }
const localCargo = join(root, '.data', 'tooling', 'cargo')
if (!env.CARGO_HOME && existsSync(join(localCargo, 'bin', 'cargo.exe'))) {
	env.CARGO_HOME = localCargo
	env.RUSTUP_HOME = join(root, '.data', 'tooling', 'rustup')
	env.PATH = `${join(localCargo, 'bin')}${delimiter}${env.PATH ?? ''}`
}

const url = new URL(env.VOICECHAT_DESKTOP_URL ?? 'http://localhost:3000')
if (
	!(
		url.protocol === 'https:' ||
		(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
	) ||
	url.username ||
	url.password
)
	throw new Error('Адрес сервера должен использовать HTTPS или локальный HTTP')
env.VOICECHAT_DESKTOP_URL = url.href

if (action !== 'build') {
	try {
		await fetch(url, { signal: AbortSignal.timeout(5000) })
	} catch {
		throw new Error(
			`Сервер ${url.origin} недоступен. Запустите bun run dev или задайте VOICECHAT_DESKTOP_URL.`
		)
	}
}

const exe = join(desktop, 'src-tauri', 'target', 'release', 'voice-chat-desktop-prototype.exe')
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
