// Assembles the assets a Desktop Release publishes. Building is
// `scripts/desktop.ts`'s job; this reads the two artifacts it produced, signs the
// NSIS setup with the updater key from the environment, and writes the updater
// manifest and the SHA-256 checksum beside them. Everything it emits is derived
// from the files on disk, so a checksum can never name a missing installer and
// `latest.json` can never carry a signature the setup does not have.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { desktopReleaseArtifacts, type DesktopReleaseArtifacts } from './desktop-artifacts'
import { signArtifact, type UpdaterKeyPair } from './desktop-signing'

const root = join(import.meta.dirname, '..')
const defaultArtifactsDirectory = join(
	root,
	'desktop',
	'src-tauri',
	'target',
	'release',
	'bundle',
	'nsis'
)

/** The three sections every Russian Desktop Release note must carry (adr/0014). */
export const RELEASE_NOTES_SECTIONS = [
	'## Что изменилось',
	'## Известные ограничения',
	'## Как установить или обновить'
] as const

/** Windows' warning is the honest first-run experience while alpha is unsigned. */
const PRERELEASE_SMARTSREEN = /smartscreen/i

export function assertReleaseNotes(notes: string, version: string): void {
	const missing = RELEASE_NOTES_SECTIONS.filter((section) => !notes.includes(section))
	if (missing.length > 0) throw new Error(`Release notes miss: ${missing.join(', ')}`)
	// Authenticode is deferred for the private-group alpha, so a prerelease has to
	// say so; a later signed prerelease would drop the requirement with the note.
	if (version.includes('-') && !PRERELEASE_SMARTSREEN.test(notes)) {
		throw new Error('Unsigned prerelease notes must call out the SmartScreen warning')
	}
}

export interface DesktopReleaseManifest {
	version: string
	notes: string
	pub_date: string
	platforms: {
		'windows-x86_64': {
			signature: string
			url: string
		}
	}
}

export function releaseManifest(options: {
	version: string
	notes: string
	pubDate: string
	signature: string
	setupName: string
	repo: string
	tag: string
}): DesktopReleaseManifest {
	const host = `https://github.com/${options.repo}/releases/download`
	const url = `${host}/${encodeURIComponent(options.tag)}/${encodeURIComponent(options.setupName)}`
	return {
		version: options.version,
		notes: options.notes,
		pub_date: options.pubDate,
		platforms: { 'windows-x86_64': { signature: options.signature, url } }
	}
}

export function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** GNU coreutils' `sha256sum` format, so a member can verify with one command. */
export function checksumFile(entries: { name: string; digest: string }[]): string {
	return `${entries.map((entry) => `${entry.digest}  ${entry.name}`).join('\n')}\n`
}

export interface AssembledDesktopRelease {
	names: DesktopReleaseArtifacts
	manifest: DesktopReleaseManifest
	checksum: string
	/** Absolute paths, in upload order: setup, signature, portable, manifest, checksum. */
	assets: string[]
}

export interface AssembleDesktopReleaseOptions {
	version: string
	tag: string
	repo: string
	artifactsDirectory?: string
	notes: string
	pubDate?: string
}

export function assembleDesktopRelease(
	options: AssembleDesktopReleaseOptions
): AssembledDesktopRelease {
	const directory = options.artifactsDirectory ?? defaultArtifactsDirectory
	const names = desktopReleaseArtifacts(options.version)
	const setupPath = join(directory, names.setup)
	const signaturePath = join(directory, names.signature)
	const portablePath = join(directory, names.portable)
	for (const path of [setupPath, portablePath]) {
		if (!existsSync(path)) throw new Error(`Missing release artifact: ${path}`)
	}
	if (!existsSync(signaturePath)) throw new Error(`Missing updater signature: ${signaturePath}`)
	assertReleaseNotes(options.notes, options.version)

	const signature = readFileSync(signaturePath, 'utf8').trim()
	if (!signature) throw new Error(`Empty updater signature: ${signaturePath}`)

	const manifest = releaseManifest({
		version: options.version,
		notes: options.notes,
		pubDate: options.pubDate ?? new Date().toISOString(),
		signature,
		setupName: names.setup,
		repo: options.repo,
		tag: options.tag
	})
	const checksum = checksumFile([
		{ name: names.setup, digest: sha256(setupPath) },
		{ name: names.portable, digest: sha256(portablePath) }
	])

	const manifestPath = join(directory, names.manifest)
	const checksumPath = join(directory, names.checksum)
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
	writeFileSync(checksumPath, checksum)

	return {
		names,
		manifest,
		checksum,
		assets: [setupPath, signaturePath, portablePath, manifestPath, checksumPath]
	}
}

/** The updater key, from the protected environment: a path or the key's contents. */
export function updaterKeyFromEnvironment(
	environment: Record<string, string | undefined> = process.env
): { key: UpdaterKeyPair; dispose: () => void } {
	const path = environment.TAURI_SIGNING_PRIVATE_KEY_PATH?.trim()
	if (path) return { key: { publicKey: '', privateKeyPath: path }, dispose: () => {} }

	const contents = environment.TAURI_SIGNING_PRIVATE_KEY?.trim()
	if (!contents) {
		throw new Error('Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH')
	}
	const directory = mkdtempSync(join(tmpdir(), 'voice-chat-updater-key-'))
	const privateKeyPath = join(directory, 'updater.key')
	writeFileSync(privateKeyPath, contents, { mode: 0o600 })
	return {
		key: { publicKey: '', privateKeyPath },
		dispose: () => rmSync(directory, { recursive: true, force: true })
	}
}

interface CliOptions {
	version: string
	tag: string
	repo: string
	artifactsDirectory: string
	notesPath: string
	pubDate?: string
}

function parseCli(argv: string[]): CliOptions {
	const flags = new Map<string, string>()
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index]
		if (!argument?.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
		const value = argv[index + 1]
		if (value === undefined || value.startsWith('--')) {
			throw new Error(`Missing value for ${argument}`)
		}
		flags.set(argument.slice(2), value)
		index += 1
	}

	const version = flags.get('version') ?? process.env.VOICECHAT_DESKTOP_VERSION
	if (!version) throw new Error('Set --version or VOICECHAT_DESKTOP_VERSION')
	const tag = flags.get('tag') ?? process.env.GITHUB_REF_NAME ?? `desktop-v${version}`
	const repo = flags.get('repo') ?? process.env.GITHUB_REPOSITORY
	if (!repo) throw new Error('Set --repo or GITHUB_REPOSITORY')
	const notesPath = flags.get('notes')
	if (!notesPath) throw new Error('Set --notes to the Russian release notes file')
	return {
		version,
		tag,
		repo,
		artifactsDirectory: flags.get('artifacts') ?? defaultArtifactsDirectory,
		notesPath,
		pubDate: flags.get('pub-date')
	}
}

function main(): void {
	const options = parseCli(process.argv.slice(2))
	if (!existsSync(options.notesPath)) {
		throw new Error(`Release notes are missing: ${options.notesPath}`)
	}
	const notes = readFileSync(options.notesPath, 'utf8')
	const setupPath = join(options.artifactsDirectory, desktopReleaseArtifacts(options.version).setup)

	const { key, dispose } = updaterKeyFromEnvironment()
	try {
		console.error(`Signing ${setupPath}`)
		signArtifact(key, setupPath, process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '')
	} finally {
		dispose()
	}

	const assembled = assembleDesktopRelease({ ...options, notes })
	console.error(
		`Assembled ${assembled.names.manifest} and ${assembled.names.checksum} in ${options.artifactsDirectory}`
	)
	// stdout is the upload contract: one absolute path per line, nothing else.
	for (const asset of assembled.assets) console.log(asset)
}

if (import.meta.main) main()
