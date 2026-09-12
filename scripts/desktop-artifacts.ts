const PRODUCT_NAME = 'Voice Chat'
const WINDOWS_ARCH = 'x64'

export interface DesktopReleaseArtifacts {
	setup: string
	signature: string
	portable: string
	manifest: string
	checksum: string
}

/**
 * Every asset a Desktop Release carries, named once so the build, the release
 * assembly and the Update feed cannot drift apart. The feed matches the setup
 * and its `.sig` by suffix and the Portable EXE by "not a setup"; the manifest
 * and checksum are for members and are deliberately not offerable artifacts.
 */
export function desktopReleaseArtifacts(version: string): DesktopReleaseArtifacts {
	const setup = `${PRODUCT_NAME}_${version}_${WINDOWS_ARCH}-setup.exe`
	return {
		setup,
		signature: `${setup}.sig`,
		portable: `${PRODUCT_NAME}_${version}_${WINDOWS_ARCH}-portable.exe`,
		manifest: 'latest.json',
		checksum: 'SHA256SUMS.txt'
	}
}
