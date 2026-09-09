import { describe, expect, test } from 'bun:test'

import { compareDesktopVersions, parseDesktopVersion } from '../server/utils/desktop-version'

describe('Desktop Release version ordering', () => {
	const order = (a: string, b: string) =>
		compareDesktopVersions(parseDesktopVersion(a)!, parseDesktopVersion(b)!)

	test('ranks a prerelease below the version it leads to', () => {
		expect(order('0.1.0-alpha.1', '0.1.0')).toBe(-1)
		expect(order('0.1.0-alpha.1', '0.1.0-alpha.2')).toBe(-1)
		expect(order('0.1.0-alpha.2', '0.1.0-alpha.10')).toBe(-1)
		expect(order('0.1.0-alpha.1', '0.1.0-beta.1')).toBe(-1)
		expect(order('0.1.0-alpha.1', '0.1.0-alpha.1.1')).toBe(-1)
		expect(order('0.2.0', '0.10.0')).toBe(-1)
		expect(order('0.1.0-alpha.1', '0.1.0-alpha.1')).toBe(0)
		expect(order('0.2.0', '0.1.0')).toBe(1)
	})

	test('rejects anything that is not a usable version', () => {
		expect(parseDesktopVersion('0.1')).toBeNull()
		expect(parseDesktopVersion('banana')).toBeNull()
		expect(parseDesktopVersion('v0.1.0')).toBeNull()
		expect(parseDesktopVersion('0.1.0-alpha..1')).toBeNull()
		expect(parseDesktopVersion('0.1.0+build.7')).not.toBeNull()
	})
})
