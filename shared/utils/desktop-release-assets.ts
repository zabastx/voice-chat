// The x64 artifact set a Desktop Release has to carry to be complete (adr/0014):
// the per-user NSIS setup, its detached updater `.sig`, and the Portable EXE. The
// Update feed decides a Release is offerable only when all three are present, and
// the release assembly uploads exactly that set. Keeping the matcher here means
// both sides answer "is this Release whole?" the same way.

/** A Release asset reduced to what the matcher needs. */
export interface NamedReleaseAsset {
	name: string
}

export interface WindowsReleaseAssets<T extends NamedReleaseAsset> {
	setup: T
	signature: T
	portable: T
}

/**
 * The setup, signature and Portable EXE of one Release, or `null` when any of
 * them is missing — a Release assembled without all three must not be offered.
 */
export function windowsReleaseAssets<T extends NamedReleaseAsset>(
	assets: readonly T[]
): WindowsReleaseAssets<T> | null {
	const x64 = assets.filter((asset) => /x64/i.test(asset.name))
	const setup = x64.find((asset) => /-setup\.exe$/i.test(asset.name))
	if (!setup) return null
	const signature = x64.find(
		(asset) => asset.name.toLowerCase() === `${setup.name.toLowerCase()}.sig`
	)
	if (!signature) return null
	const portable = x64.find(
		(asset) => /\.exe$/i.test(asset.name) && !/-setup\.exe$/i.test(asset.name)
	)
	if (!portable) return null
	return { setup, signature, portable }
}
