import { describe, expect, test } from 'bun:test'

import { resolveNativeBridge } from '../shared/utils/native-bridge'
import { runNativeBridgeContract } from './native-bridge-contract'

// Mirrors what desktop/src-tauri/src/bridge.rs freezes onto the remote page. The same
// scenarios run against this shape here and against the real object in `desktop:check`.
function desktopCandidate(calls: boolean[] = []) {
	return {
		desktopVersion: '0.1.0-alpha.1',
		bridgeVersion: 1,
		capabilities: ['voice-lifecycle'],
		setVoiceActive: (active: boolean) => {
			calls.push(active)
		}
	}
}

describe('Native Bridge contract', () => {
	for (const [label, candidate, desktop] of [
		['browser adapter', undefined, false],
		['desktop adapter', desktopCandidate(), true]
	] as const) {
		test(`${label} satisfies every scenario`, () => {
			const failed = runNativeBridgeContract(candidate, { desktop })
				.filter((result) => !result.passed)
				.map((result) => `${result.name}: ${result.detail}`)
			expect(failed).toEqual([])
		})
	}
})

describe('Native Bridge reverse operations', () => {
	test('forwards a validated voice lifecycle signal to the shell', () => {
		const calls: boolean[] = []
		const bridge = resolveNativeBridge(desktopCandidate(calls))

		bridge.setVoiceActive(true)
		bridge.setVoiceActive(false)

		expect(calls).toEqual([true, false])
	})

	test('never forwards an operation the descriptor does not declare', () => {
		const calls: boolean[] = []
		const bridge = resolveNativeBridge({ ...desktopCandidate(calls), capabilities: [] })

		bridge.setVoiceActive(true)

		expect(bridge.supports('voice-lifecycle')).toBe(false)
		expect(calls).toEqual([])
	})

	test('never forwards an operation the shell did not register', () => {
		const bridge = resolveNativeBridge({
			desktopVersion: '0.1.0-alpha.1',
			bridgeVersion: 1,
			capabilities: ['voice-lifecycle']
		})

		expect(bridge.isDesktop).toBe(true)
		expect(() => bridge.setVoiceActive(true)).not.toThrow()
	})

	test('a capability does not lend its authority to a neighbour', () => {
		const reached: string[] = []
		const bridge = resolveNativeBridge({
			...desktopCandidate(),
			capabilities: ['voice-lifecycle'],
			showNotification: () => reached.push('showNotification'),
			openLogFolder: () => reached.push('openLogFolder')
		})

		expect(Object.keys(bridge)).toEqual(['descriptor', 'isDesktop', 'supports', 'setVoiceActive'])
		expect(reached).toEqual([])
	})
})
