// Version algebra for the Desktop Release line (adr/0014). Desktop tags are
// `desktop-v<version>` and the alpha line is all prereleases, so ordering has to
// get `alpha.2 < alpha.10 < beta.1 < 0.1.0` right — a naive string compare would
// offer an older build as an update.

export interface DesktopVersion {
	major: number
	minor: number
	patch: number
	/** dot-separated prerelease identifiers, empty for a stable version */
	prerelease: (string | number)[]
}

/**
 * The semver subset a Desktop Release may use: `major.minor.patch` with an
 * optional prerelease and ignored build metadata. Returns null for anything
 * else, which is how a malformed tag is dropped rather than ranked.
 */
export function parseDesktopVersion(raw: string): DesktopVersion | null {
	const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(raw.trim())
	if (!match) return null
	const identifiers = match[4] ? match[4].split('.') : []
	// `1.0.0-alpha..1` matches the character class but has an empty identifier
	if (identifiers.some((identifier) => identifier === '')) return null
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: identifiers.map((identifier) =>
			/^\d+$/.test(identifier) ? Number(identifier) : identifier
		)
	}
}

/** Semver precedence: a prerelease sorts below the release it leads up to. */
export function compareDesktopVersions(a: DesktopVersion, b: DesktopVersion): number {
	if (a.major !== b.major) return a.major < b.major ? -1 : 1
	if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1
	if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1
	if (!a.prerelease.length || !b.prerelease.length) {
		if (a.prerelease.length === b.prerelease.length) return 0
		return a.prerelease.length ? -1 : 1
	}
	const length = Math.max(a.prerelease.length, b.prerelease.length)
	for (let index = 0; index < length; index++) {
		const left = a.prerelease[index]
		const right = b.prerelease[index]
		// a shorter set of identifiers sorts lower: alpha.1 < alpha.1.1
		if (left === undefined) return -1
		if (right === undefined) return 1
		if (left === right) continue
		if (typeof left === 'number' && typeof right === 'number') return left < right ? -1 : 1
		// numeric identifiers always sort below alphanumeric ones
		if (typeof left === 'number') return -1
		if (typeof right === 'number') return 1
		return left < right ? -1 : 1
	}
	return 0
}

export function formatDesktopVersion(version: DesktopVersion): string {
	const core = `${version.major}.${version.minor}.${version.patch}`
	return version.prerelease.length ? `${core}-${version.prerelease.join('.')}` : core
}
