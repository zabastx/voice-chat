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
	RELEASE_NOTES_SECTIONS,
	releaseManifest,
	sha256
} from '../scripts/desktop-release'

const workflowPath = new URL('../.github/workflows/desktop-release.yml', import.meta.url)
const VERSION = '0.1.0-alpha.1'
const NOTES = `# Voice Chat ${VERSION}

## Что изменилось

- Ничего примечательного.

## Известные ограничения

- Windows SmartScreen может показать предупреждение: сборка не подписана Authenticode.

## Как установить или обновить

- Запустите installer или Portable EXE.
`

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

describe('desktop release assembly', () => {
	test('names every published asset once', () => {
		expect(desktopReleaseArtifacts(VERSION)).toEqual({
			setup: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe',
			signature: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe.sig',
			portable: 'Voice Chat_0.1.0-alpha.1_x64-portable.exe',
			manifest: 'latest.json',
			checksum: 'SHA256SUMS.txt'
		})
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

	test('points the manifest at the setup asset under its own tag', () => {
		const manifest = releaseManifest({
			version: VERSION,
			notes: NOTES,
			pubDate: '2026-09-12T00:00:00.000Z',
			signature: 'signature-value',
			setupName: desktopReleaseArtifacts(VERSION).setup,
			repo: 'zabastx/voice-chat',
			tag: `desktop-v${VERSION}`
		})

		expect(manifest).toEqual({
			version: VERSION,
			notes: NOTES,
			pub_date: '2026-09-12T00:00:00.000Z',
			platforms: {
				'windows-x86_64': {
					signature: 'signature-value',
					url: `https://github.com/zabastx/voice-chat/releases/download/desktop-v${VERSION}/Voice%20Chat_${VERSION}_x64-setup.exe`
				}
			}
		})
	})

	test('collects the signed setup, Portable EXE, manifest and checksum', () => {
		const directory = mkdtempSync(join(tmpdir(), 'voice-chat-release-'))
		try {
			const names = desktopReleaseArtifacts(VERSION)
			writeFileSync(join(directory, names.setup), 'installer-bytes')
			writeFileSync(join(directory, names.signature), 'signature-value\n')
			writeFileSync(join(directory, names.portable), 'portable-bytes')

			const assembled = assembleDesktopRelease({
				version: VERSION,
				tag: `desktop-v${VERSION}`,
				repo: 'zabastx/voice-chat',
				artifactsDirectory: directory,
				notes: NOTES,
				pubDate: '2026-09-12T00:00:00.000Z'
			})

			expect(assembled.assets).toHaveLength(5)
			for (const asset of assembled.assets) expect(existsSync(asset)).toBe(true)

			const manifest = JSON.parse(readFileSync(join(directory, names.manifest), 'utf8')) as {
				version: string
				platforms: { 'windows-x86_64': { signature: string; url: string } }
			}
			expect(manifest.version).toBe(VERSION)
			expect(manifest.platforms['windows-x86_64'].signature).toBe('signature-value')
			expect(manifest.platforms['windows-x86_64'].url).toEndWith(encodeURIComponent(names.setup))

			const setupDigest = sha256(join(directory, names.setup))
			const checksum = readFileSync(join(directory, names.checksum), 'utf8')
			expect(checksum).toBe(
				checksumFile([
					{ name: names.setup, digest: setupDigest },
					{ name: names.portable, digest: sha256(join(directory, names.portable)) }
				])
			)
			expect(checksum).toContain(`${setupDigest}  ${names.setup}`)
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})

	test('refuses a Release whose setup was never signed', () => {
		const directory = mkdtempSync(join(tmpdir(), 'voice-chat-release-'))
		try {
			const names = desktopReleaseArtifacts(VERSION)
			writeFileSync(join(directory, names.setup), 'installer-bytes')
			writeFileSync(join(directory, names.portable), 'portable-bytes')

			expect(() =>
				assembleDesktopRelease({
					version: VERSION,
					tag: `desktop-v${VERSION}`,
					repo: 'zabastx/voice-chat',
					artifactsDirectory: directory,
					notes: NOTES
				})
			).toThrow('signature')
		} finally {
			rmSync(directory, { recursive: true, force: true })
		}
	})
})

describe('desktop release workflow', () => {
	test('is triggered only by desktop-v tags and reads the repository by default', async () => {
		const workflow = await loadWorkflow()
		expect(Object.keys(workflow.on ?? {})).toEqual(['push'])
		expect(workflow.on?.push).toEqual({ tags: ['desktop-v*'] })
		expect(workflow.permissions).toEqual({ contents: 'read' })
	})

	test('rejects a tag that is malformed or not reachable from master', async () => {
		const script = jobScript(await loadWorkflow(), 'guard')
		expect(script).toContain('GITHUB_REF_NAME')
		expect(script).toContain('desktop-v<semver>')
		expect(script).toContain('git merge-base --is-ancestor')
		expect(script).toContain('origin/master')
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

	test('gates the updater key behind the protected desktop-release environment', async () => {
		const workflow = await loadWorkflow()
		const release = workflow.jobs?.release
		expect(release?.environment).toBe('desktop-release')
		expect(release?.permissions).toEqual({ contents: 'write' })

		const releaseJson = JSON.stringify(release)
		expect(releaseJson).toContain('secrets.TAURI_SIGNING_PRIVATE_KEY')
		expect(releaseJson).toContain('secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD')
		expect(releaseJson).toContain('vars.DESKTOP_UPDATER_PUBKEY')

		for (const [name, job] of Object.entries(workflow.jobs ?? {})) {
			if (name === 'release') continue
			expect(JSON.stringify(job)).not.toContain('TAURI_SIGNING_PRIVATE_KEY')
		}
	})

	test('assembles and publishes a draft with the signed asset set', async () => {
		const script = jobScript(await loadWorkflow(), 'release')
		expect(script).toContain('bun run desktop:build')
		expect(script).toContain('bun scripts/desktop-release.ts')
		expect(script).toContain('release-notes')
		expect(script).toContain('gh release create')
		expect(script).toContain('--draft')
		expect(script).toContain('--notes-file')
		expect(script).toContain('mapfile -t assets')
	})
})
