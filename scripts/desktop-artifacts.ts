const PRODUCT_NAME = 'Voice Chat'
const WINDOWS_ARCH = 'x64'

export function desktopReleaseArtifacts(version: string) {
	return {
		setup: `${PRODUCT_NAME}_${version}_${WINDOWS_ARCH}-setup.exe`,
		portable: `${PRODUCT_NAME}_${version}_${WINDOWS_ARCH}-portable.exe`
	}
}
