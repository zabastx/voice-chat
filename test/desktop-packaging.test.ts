import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'

const configPath = new URL('../desktop/src-tauri/tauri.conf.json', import.meta.url)
const installerHooksPath = new URL(
	'../desktop/src-tauri/windows/installer-hooks.nsh',
	import.meta.url
)

interface DesktopConfig {
	bundle?: {
		targets?: string[] | string
		windows?: {
			webviewInstallMode?: { type?: string }
			nsis?: {
				installMode?: string
				installerHooks?: string
				languages?: string[]
			}
		}
	}
}

describe('desktop packaging', () => {
	test('uses the release asset names consumed by the Update feed', async () => {
		const { desktopReleaseArtifacts } = await import('../scripts/desktop-artifacts')

		expect(desktopReleaseArtifacts('0.1.0-alpha.1')).toEqual({
			setup: 'Voice Chat_0.1.0-alpha.1_x64-setup.exe',
			portable: 'Voice Chat_0.1.0-alpha.1_x64-portable.exe'
		})
	})

	test('builds only a per-user NSIS installer with the WebView2 bootstrapper', async () => {
		const config = JSON.parse(await readFile(configPath, 'utf8')) as DesktopConfig

		expect(config.bundle?.targets).toEqual(['nsis'])
		expect(config.bundle?.windows?.webviewInstallMode).toEqual({
			type: 'downloadBootstrapper'
		})
		expect(config.bundle?.windows?.nsis).toMatchObject({
			installMode: 'currentUser',
			languages: ['Russian']
		})
	})

	test('removes the shared profile on uninstall without touching the WebView2 Runtime', async () => {
		const config = JSON.parse(await readFile(configPath, 'utf8')) as DesktopConfig
		expect(config.bundle?.windows?.nsis?.installerHooks).toBe('./windows/installer-hooks.nsh')

		const hooks = await readFile(installerHooksPath, 'utf8')
		expect(hooks).toContain('NSIS_HOOK_POSTUNINSTALL')
		expect(hooks).toContain('$UpdateMode')
		expect(hooks).toContain('$LOCALAPPDATA\\${BUNDLEID}')
		expect(hooks).toContain('$APPDATA\\${BUNDLEID}')
		expect(hooks).not.toMatch(/EdgeUpdate|WEBVIEW2APPGUID|MicrosoftEdgeWebView/i)
	})
})
