// Nuxt remains on the server; this process only builds or launches the desktop shell.
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { desktopReleaseArtifacts } from './desktop-artifacts'

const root = join(import.meta.dirname, '..')
const desktop = join(root, 'desktop')
const action = process.argv[2] ?? 'run'
if (!['dev', 'compile', 'build', 'run'].includes(action)) {
	throw new Error('Ожидается dev, compile, build или run')
}

const env = { ...process.env }
const localCargo = join(root, '.data', 'tooling', 'cargo')
if (!env.CARGO_HOME && existsSync(join(localCargo, 'bin', 'cargo.exe'))) {
	env.CARGO_HOME = localCargo
	env.RUSTUP_HOME = join(root, '.data', 'tooling', 'rustup')
	env.PATH = `${join(localCargo, 'bin')}${delimiter}${env.PATH ?? ''}`
}

if (action === 'dev') {
	// Keep this fast runner check aligned with desktop/src-tauri/origin.rs; Rust enforces the artifact.
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

const tauriRoot = join(desktop, 'src-tauri')
const exe = join(tauriRoot, 'target', 'release', 'voice-chat.exe')
const cli = join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

function runTauri(command: string, args: string[] = []) {
	const result = spawnSync(process.execPath, [cli, command, ...args], {
		cwd: desktop,
		env,
		stdio: 'inherit'
	})
	if (result.error) throw result.error
	if (result.status !== 0) {
		throw new Error(`Tauri ${command} failed with exit code ${result.status ?? 1}`)
	}
}

if (action === 'run') {
	if (!existsSync(exe)) throw new Error('Сначала выполните bun run desktop:build')
	const result = spawnSync(exe, process.argv.slice(3), { cwd: root, env, stdio: 'inherit' })
	if (result.error) throw result.error
	process.exitCode = result.status ?? 1
} else if (action === 'build') {
	if (process.platform !== 'win32' || process.arch !== 'x64') {
		throw new Error('Release-сборка поддерживает только Windows x64')
	}
	const config = JSON.parse(readFileSync(join(tauriRoot, 'tauri.conf.json'), 'utf8')) as {
		version: string
	}
	const names = desktopReleaseArtifacts(config.version)
	const bundleDirectory = join(tauriRoot, 'target', 'release', 'bundle', 'nsis')
	const portable = join(bundleDirectory, names.portable)
	const setup = join(bundleDirectory, names.setup)
	const staging = mkdtempSync(join(tmpdir(), 'voice-chat-portable-'))
	const stagedPortable = join(staging, names.portable)

	try {
		// Preserve the unbundled executable before the NSIS bundler stamps its own mode.
		runTauri('build', ['--no-bundle'])
		if (!existsSync(exe)) throw new Error(`Release executable is missing: ${exe}`)
		copyFileSync(exe, stagedPortable)

		runTauri('bundle', ['--bundles', 'nsis'])
		if (!existsSync(setup)) throw new Error(`NSIS installer is missing: ${setup}`)
		mkdirSync(bundleDirectory, { recursive: true })
		copyFileSync(stagedPortable, portable)
		console.log(`Release artifacts:\n${setup}\n${portable}`)
	} finally {
		rmSync(staging, { recursive: true, force: true })
	}
} else {
	runTauri(action === 'compile' ? 'build' : action, action === 'compile' ? ['--no-bundle'] : [])
}
