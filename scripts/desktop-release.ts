// Assembles the assets a Desktop Release publishes. Building is
// `scripts/desktop.ts`'s job. This signs the NSIS setup with the updater key from
// the environment, and — after the draft exists on GitHub — derives `latest.json`
// and the SHA-256 checksum from the assets GitHub actually stored. GitHub renames
// uploaded filenames (spaces become dots), so the published name and download URL
// are read back rather than guessed: the manifest can only point at a real,
// signed asset, and the checksum can only name the installer a member downloads.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
	type NamedReleaseAsset,
	type WindowsReleaseAssets,
	windowsReleaseAssets
} from '../shared/utils/desktop-release-assets'
import { desktopReleaseArtifacts } from './desktop-artifacts'
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
const PRERELEASE_SMARTSCREEN = /smartscreen/i

export function assertReleaseNotes(notes: string, version: string): void {
	const missing = RELEASE_NOTES_SECTIONS.filter((section) => !notes.includes(section))
	if (missing.length > 0) throw new Error(`Release notes miss: ${missing.join(', ')}`)
	// Authenticode is deferred for the private-group alpha, so a prerelease has to
	// say so; a later signed prerelease would drop the requirement with the note.
	if (version.includes('-') && !PRERELEASE_SMARTSCREEN.test(notes)) {
		throw new Error('Unsigned prerelease notes must call out the SmartScreen warning')
	}
}

/** A Release asset as GitHub's REST API reports it, after any renaming. */
export interface PublishedReleaseAsset extends NamedReleaseAsset {
	browser_download_url: string
	/** GitHub's byte count for the uploaded asset, when the response carries it. */
	size?: number
}

export function selectPublishedWindowsAssets(
	assets: readonly PublishedReleaseAsset[]
): WindowsReleaseAssets<PublishedReleaseAsset> {
	const selected = windowsReleaseAssets(assets)
	if (!selected) {
		throw new Error('The published Release is missing its x64 setup, .sig or Portable EXE')
	}
	return selected
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
	setupUrl: string
}): DesktopReleaseManifest {
	return {
		version: options.version,
		notes: options.notes,
		pub_date: options.pubDate,
		platforms: {
			'windows-x86_64': { signature: options.signature, url: options.setupUrl }
		}
	}
}

export function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** GNU coreutils' `sha256sum` format, so a member can verify with one command. */
export function checksumFile(entries: { name: string; digest: string }[]): string {
	return `${entries.map((entry) => `${entry.digest}  ${entry.name}`).join('\n')}\n`
}

export interface DesktopReleaseMetadata {
	manifest: DesktopReleaseManifest
	checksum: string
	manifestPath: string
	checksumPath: string
}

export interface AssembleDesktopReleaseOptions {
	version: string
	notes: string
	pubDate?: string
	artifactsDirectory?: string
	/** what GitHub actually stored for this Release */
	published: WindowsReleaseAssets<PublishedReleaseAsset>
}

export function assembleDesktopRelease(
	options: AssembleDesktopReleaseOptions
): DesktopReleaseMetadata {
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

	// The uploaded bytes have to be the ones we built and signed; the size is the
	// cheap check here, and the updater's own signature is the authoritative one.
	for (const [path, published] of [
		[setupPath, options.published.setup],
		[portablePath, options.published.portable]
	] as const) {
		if (typeof published.size === 'number' && statSync(path).size !== published.size) {
			throw new Error(`Published ${published.name} does not match the built artifact: ${path}`)
		}
	}

	const signature = readFileSync(signaturePath, 'utf8').trim()
	if (!signature) throw new Error(`Empty updater signature: ${signaturePath}`)

	const manifest = releaseManifest({
		version: options.version,
		notes: options.notes,
		pubDate: options.pubDate ?? new Date().toISOString(),
		signature,
		setupUrl: options.published.setup.browser_download_url
	})
	const checksum = checksumFile([
		{ name: options.published.setup.name, digest: sha256(setupPath) },
		{ name: options.published.portable.name, digest: sha256(portablePath) }
	])

	const manifestPath = join(directory, names.manifest)
	const checksumPath = join(directory, names.checksum)
	writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
	writeFileSync(checksumPath, checksum)
	return { manifest, checksum, manifestPath, checksumPath }
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
	command: 'sign' | 'manifest'
	version: string
	artifactsDirectory: string
	notesPath: string
	releasePath?: string
	pubDate?: string
}

function parseCli(argv: string[]): CliOptions {
	const [command, ...rest] = argv
	if (command !== 'sign' && command !== 'manifest') {
		throw new Error('Expected `sign` or `manifest`')
	}
	const flags = new Map<string, string>()
	for (let index = 0; index < rest.length; index += 1) {
		const argument = rest[index]
		if (!argument?.startsWith('--')) throw new Error(`Unexpected argument: ${argument}`)
		const value = rest[index + 1]
		if (value === undefined || value.startsWith('--')) {
			throw new Error(`Missing value for ${argument}`)
		}
		flags.set(argument.slice(2), value)
		index += 1
	}

	const version = flags.get('version') ?? process.env.VOICECHAT_DESKTOP_VERSION
	if (!version) throw new Error('Set --version or VOICECHAT_DESKTOP_VERSION')
	const notesPath = flags.get('notes')
	if (!notesPath) throw new Error('Set --notes to the Russian release notes file')
	return {
		command,
		version,
		artifactsDirectory: flags.get('artifacts') ?? defaultArtifactsDirectory,
		notesPath,
		releasePath: flags.get('release'),
		pubDate: flags.get('pub-date')
	}
}

function printAssets(paths: string[]): void {
	// stdout is the upload contract: one absolute path per line, nothing else.
	for (const path of paths) console.log(path)
}

function commandSign(options: CliOptions, notes: string): void {
	assertReleaseNotes(notes, options.version)
	const names = desktopReleaseArtifacts(options.version)
	const setupPath = join(options.artifactsDirectory, names.setup)
	if (!existsSync(setupPath)) throw new Error(`Missing release artifact: ${setupPath}`)
	const { key, dispose } = updaterKeyFromEnvironment()
	try {
		console.error(`Signing ${setupPath}`)
		signArtifact(key, setupPath, process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '')
	} finally {
		dispose()
	}
	// what the draft carries first; the manifest and checksum follow once GitHub
	// has told us the names it stored them under
	printAssets([
		setupPath,
		join(options.artifactsDirectory, names.signature),
		join(options.artifactsDirectory, names.portable)
	])
}

function commandManifest(options: CliOptions, notes: string): void {
	if (!options.releasePath) throw new Error('Set --release to the published Release JSON')
	if (!existsSync(options.releasePath)) {
		throw new Error(`Published Release JSON is missing: ${options.releasePath}`)
	}
	const release = JSON.parse(readFileSync(options.releasePath, 'utf8')) as
		| { assets?: PublishedReleaseAsset[] }
		| PublishedReleaseAsset[]
	const assets = Array.isArray(release) ? release : (release.assets ?? [])
	const metadata = assembleDesktopRelease({
		...options,
		notes,
		published: selectPublishedWindowsAssets(assets)
	})
	console.error(
		`Assembled ${metadata.manifestPath} and ${metadata.checksumPath} for the published assets`
	)
	printAssets([metadata.manifestPath, metadata.checksumPath])
}

function main(): void {
	const options = parseCli(process.argv.slice(2))
	if (!existsSync(options.notesPath)) {
		throw new Error(`Release notes are missing: ${options.notesPath}`)
	}
	const notes = readFileSync(options.notesPath, 'utf8')
	if (options.command === 'sign') commandSign(options, notes)
	else commandManifest(options, notes)
}

if (import.meta.main) main()
