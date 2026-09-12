import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { desktopReleaseArtifacts } from '../scripts/desktop-artifacts'
import {
	assembleDesktopRelease,
	assertReleaseNotes,
	checksumFile,
	type PublishedReleaseAsset,
	RELEASE_NOTES_SECTIONS,
	releaseManifest,
	selectPublishedWindowsAssets,
	sha256,
	updaterKeyFromEnvironment
} from '../scripts/desktop-release'
import { generateUpdaterKey, signArtifact } from '../scripts/desktop-signing'
import { windowsReleaseAssets } from '../shared/utils/desktop-release-assets'

const workflowPath = new URL('../.github/workflows/desktop-release.yml', import.meta.url)
const VERSION = '0.1.0-alpha.1'
const TAG = `desktop-v${VERSION}`
const NOTES = `# Voice Chat ${VERSION}

## Что изменилось

- Ничего примечательного.

## Известные ограничения

- Windows SmartScreen может показать предупреждение: сборка не подписана Authenticode.

## Как установить или обновить

- Запустите installer или Portable EXE.
`

/**
 * GitHub renames uploaded assets (spaces become dots), so these are the names a
 * Release actually serves — deliberately different from the local file names.
 */
const PUBLISHED = desktopReleaseArtifacts(VERSION)
const publishedSetup = `Voice.Chat_${VERSION}_x64-setup.exe`
const publishedSignature = `${publishedSetup}.sig`
const publishedPortable = `Voice.Chat_${VERSION}_x64-portable.exe`

function published(name: string, size?: number): PublishedReleaseAsset {
	return {
		name,
		browser_download_url: `https://github.com/zabastx/voice-chat/releases/download/${TAG}/${name}`,
		size
	}
}

function publishedSet(): ReturnType<typeof selectPublishedWindowsAssets> {
	return selectPublishedWindowsAssets([
		published(publishedPortable, 'portable-bytes'.length),
		published(publishedSignature, 'signature-value\n'.length),
		published(publishedSetup, 'installer-bytes'.length)
	])
}

interface WorkflowStep {
	name?: string
	uses?: string
	run?: string
	env?: Record<string, unknown>
}

interface WorkflowJob {
	needs?: string | string[]
	environment?: string
	permissions?: Record<string, string>
	'runs-on'?: string
	env?: Record<string, unknown>
	steps?: WorkflowStep[]
}

interface Workflow {
	on?: Record<string, unknown>
	permissions?: Record<string, string>
	jobs?: Record<string, WorkflowJob>
}

async function loadWorkflow(): Promise<Workflow> {
	return Bun.YAML.parse(await readFile(workflowPath, 'utf8')) as Workflow
}

function jobScript(workflow: Workflow, job: string): string {
	return (workflow.jobs?.[job]?.steps ?? []).map((step) => step.run ?? '').join('\n')
}

describe('desktop release assets', () => {
	test('names every published asset once', () => {
		expect(PUBLISHED).toEqual({
			setup: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe',
			signature: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe.sig',
			portable: 'Voice Chat_0.1.0-alpha.1_x64-portable.exe',
			manifest: 'latest.json',
			checksum: 'SHA256SUMS.txt'
		})
	})

	test('the feed and the release assembly agree on a complete x64 set', () => {
		const complete = [
			published(publishedSetup),
			published(publishedSignature),
			published(publishedPortable)
		]
		expect(windowsReleaseAssets(complete)?.setup.name).toBe(publishedSetup)
		expect(windowsReleaseAssets(complete)?.portable.name).toBe(publishedPortable)
		for (const missing of [publishedSetup, publishedSignature, publishedPortable]) {
			const partial = complete.filter((asset) => asset.name !== missing)
			expect(windowsReleaseAssets(partial)).toBeNull()
			expect(() => selectPublishedWindowsAssets(partial)).toThrow('missing')
		}
	})

	test('requires the Russian sections and the SmartScreen warning for a prerelease', () => {
		for (const section of RELEASE_NOTES_SECTIONS) {
			expect(() => assertReleaseNotes(NOTES.replace(section, '## Другое'), VERSION)).toThrow(
				section
			)
		}
		expect(() =>
			assertReleaseNotes(NOTES.replace('SmartScreen', 'предупреждение'), VERSION)
		).toThrow('SmartScreen')
		expect(() => assertReleaseNotes(NOTES, VERSION)).not.toThrow()
	})

	test('points the manifest at the URL GitHub serves the setup under', () => {
		const manifest = releaseManifest({
			version: VERSION,
			notes: NOTES,
			pubDate: '2026-09-12T00:00:00.000Z',
			signature: 'signature-value',
			setupUrl: published(publishedSetup).browser_download_url
		})

		expect(manifest).toEqual({
			version: VERSION,
			notes: NOTES,
			pub_date: '2026-09-12T00:00:00.000Z',
			platforms: {
				'windows-x86_64': {
					signature: 'signature-value',
					url: `https://github.com/zabastx/voice-chat/releases/download/${TAG}/${publishedSetup}`
				}
			}
		})
	})
})

describe('desktop release assembly', () => {
	test('checksums the published names against the built bytes', () => {
		const directory = mkdtempSync(join(tmpdir(), 'voice-chat-release-'))
		try {
			writeFileSync(join(directory, PUBLISHED.setup), 'installer-bytes')
			writeFileSync(join(directory, PUBLISHED.signature), 'signature-value\n')
			writeFileSync(join(directory, PUBLISHED.portable), 'portable-bytes')

			const metadata = assembleDesktopRelease({
				version: VERSION,
				notes: NOTES,
				artifactsDirectory: directory,
				published: publishedSet(),
				pubDate: '2026-09-12T00:00:00.000Z'
			})

			expect(existsSync(metadata.manifestPath)).toBe(true)
			expect(existsSync(metadata.checksumPath)).toBe(true)
			const manifest = JSON.parse(readFileSync(metadata.manifestPath, 'utf8')) as {
				version: string
				platforms: { 'windows-x86_64': { signature: string; url: string } }
			}
			expect(manifest.version).toBe(VERSION)
			expect(manifest.platforms['windows-x86_64']).toEqual({
				signature: 'signature-value',
				url: published(publishedSetup).browser_download_url
			})

			const setupDigest = sha256(join(directory, PUBLISHED.setup))
			expect(metadata.checksum).toBe(
				checksumFile([
					{ name: publishedSetup, digest: setupDigest },
					{ name: publishedPortable, digest: sha256(join(directory, PUBLISHED.portable)) }
				])
			)
			// the checksum names the file a member downloads, not the local one
			expect(metadata.checksum).toContain(`${setupDigest}  ${publishedSetup}`)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	test('points the manifest at the tag root, not the draft-only untagged one', () => {
		const directory = mkdtempSync(join(tmpdir(), 'voice-chat-release-'))
		try {
			writeFileSync(join(directory, PUBLISHED.setup), 'installer-bytes')
			writeFileSync(join(directory, PUBLISHED.signature), 'signature-value\n')
			writeFileSync(join(directory, PUBLISHED.portable), 'portable-bytes')

			const metadata = assembleDesktopRelease({
				version: VERSION,
				notes: NOTES,
				artifactsDirectory: directory,
				published: publishedSet(),
				downloadRoot: `https://github.com/zabastx/voice-chat/releases/download/${TAG}`
			})

			expect(metadata.manifest.platforms['windows-x86_64'].url).toBe(
				`https://github.com/zabastx/voice-chat/releases/download/${TAG}/${publishedSetup}`
			)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	test('refuses a published asset that is not the artifact that was built', () => {
		const directory = mkdtempSync(join(tmpdir(), 'voice-chat-release-'))
		try {
			writeFileSync(join(directory, PUBLISHED.setup), 'installer-bytes')
			writeFileSync(join(directory, PUBLISHED.signature), 'signature-value\n')
			writeFileSync(join(directory, PUBLISHED.portable), 'portable-bytes')
			const stored = selectPublishedWindowsAssets([
				published(publishedSetup, 999_999),
				published(publishedSignature),
				published(publishedPortable)
			])

			expect(() =>
				assembleDesktopRelease({
					version: VERSION,
					notes: NOTES,
					artifactsDirectory: directory,
					published: stored
				})
			).toThrow('does not match')
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	test('refuses a Release whose setup was never signed', () => {
		const directory = mkdtempSync(join(tmpdir(), 'voice-chat-release-'))
		try {
			writeFileSync(join(directory, PUBLISHED.setup), 'installer-bytes')
			writeFileSync(join(directory, PUBLISHED.portable), 'portable-bytes')

			expect(() =>
				assembleDesktopRelease({
					version: VERSION,
					notes: NOTES,
					artifactsDirectory: directory,
					published: publishedSet()
				})
			).toThrow('signature')
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})
})

describe('desktop release signing', () => {
	test('signs with an env-supplied key while TAURI_SIGNING_PRIVATE_KEY is present', () => {
		const directory = mkdtempSync(join(tmpdir(), 'voice-chat-signing-'))
		const previous = process.env.TAURI_SIGNING_PRIVATE_KEY
		try {
			const generated = generateUpdaterKey(directory)
			const artifact = join(directory, PUBLISHED.setup)
			writeFileSync(artifact, 'stand-in installer bytes')

			// The release job has the key in the environment; the CLI folds it into
			// its own --private-key, which used to collide with --private-key-path.
			const { key, dispose } = updaterKeyFromEnvironment({
				TAURI_SIGNING_PRIVATE_KEY: readFileSync(generated.privateKeyPath, 'utf8')
			})
			process.env.TAURI_SIGNING_PRIVATE_KEY = readFileSync(generated.privateKeyPath, 'utf8')
			try {
				const signature = signArtifact(key, artifact, '')
				expect(signature.length).toBeGreaterThan(0)
				expect(existsSync(`${artifact}.sig`)).toBe(true)
			} finally {
				dispose()
			}
		} finally {
			if (previous === undefined) delete process.env.TAURI_SIGNING_PRIVATE_KEY
			else process.env.TAURI_SIGNING_PRIVATE_KEY = previous
			rmSync(directory, { recursive: true, force: true })
		}
	})
})

describe('desktop release workflow', () => {
	test('is triggered by desktop-v tags and by a test-only dispatch', async () => {
		const workflow = await loadWorkflow()
		expect(Object.keys(workflow.on ?? {})).toEqual(['push', 'workflow_dispatch'])
		expect(workflow.on?.push).toEqual({ tags: ['desktop-v*'] })
		expect(workflow.on?.workflow_dispatch).toEqual({
			inputs: {
				tag: {
					description: 'Desktop tag to build as a draft (desktop-v<semver>)',
					required: true,
					default: 'desktop-v0.1.0-alpha.1'
				}
			}
		})
		expect(workflow.permissions).toEqual({ contents: 'read' })
	})

	test('rejects a tag that is malformed or not reachable from master', async () => {
		const script = jobScript(await loadWorkflow(), 'guard')
		expect(script).toContain('GITHUB_REF_NAME')
		expect(script).toContain('desktop-v<semver>')
		expect(script).toContain('git merge-base --is-ancestor')
		expect(script).toContain('origin/master')
		// the dispatch path carries the tag as an input and is a draft test only
		expect(script).toContain('DISPATCH_TAG')
		expect(script).toContain('workflow_dispatch')
	})

	test('runs every quality gate with no signing material before the release', async () => {
		const workflow = await loadWorkflow()
		expect(workflow.jobs?.quality?.needs).toBe('guard')
		expect(workflow.jobs?.release?.needs).toEqual(['guard', 'quality'])

		const script = jobScript(workflow, 'quality')
		for (const gate of [
			'bun install --frozen-lockfile',
			'bun run fmt:check',
			'bun run lint',
			'bun run typecheck',
			'bun run test',
			'cargo fmt',
			'cargo check',
			'cargo test'
		]) {
			expect(script).toContain(gate)
		}
		expect(JSON.stringify(workflow.jobs?.quality)).not.toContain('TAURI_SIGNING_PRIVATE_KEY')
	})

	test('gates the updater key behind the protected environment and one signing step', async () => {
		const workflow = await loadWorkflow()
		const release = workflow.jobs?.release
		expect(release?.environment).toBe('desktop-release')
		expect(release?.permissions).toEqual({ contents: 'write' })
		expect(release?.env?.RELEASE_NOTES).toContain('release-notes')

		for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
			if (name === 'release') continue
			expect(JSON.stringify(job)).not.toContain('TAURI_SIGNING_PRIVATE_KEY')
		}
		const signingSteps = (release?.steps ?? []).filter((step) =>
			JSON.stringify(step.env ?? {}).includes('TAURI_SIGNING_PRIVATE_KEY')
		)
		expect(signingSteps).toHaveLength(1)
		expect(signingSteps[0]?.run).toContain('desktop-release.ts sign')
	})

	test('publishes a draft, then derives the metadata from the stored assets', async () => {
		const script = jobScript(await loadWorkflow(), 'release')
		expect(script).toContain('bun run desktop:build')
		expect(script).toContain('desktop-release.ts sign')
		expect(script).toContain('gh release create')
		expect(script).toContain('--draft')
		expect(script).toContain('--notes-file')
		expect(script).toContain('mapfile -t binaries')
		// a draft's tag has no git ref, so it is found in the release list by id
		expect(script).toContain('--paginate')
		expect(script).toContain('.tag_name ==')
		expect(script).toContain('.draft')
		expect(script).toContain('releases/$release_id')
		expect(script).toContain('--download-root')
		expect(script).toContain('releases/download/')
		expect(script).toContain('desktop-release.ts manifest')
		expect(script).toContain('mapfile -t metadata')
		expect(script).toContain('gh release upload')
	})
})
