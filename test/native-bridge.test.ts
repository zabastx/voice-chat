import { describe, expect, test } from 'bun:test'

import {
	NOTIFICATION_BODY_LIMIT,
	NOTIFICATION_TITLE_LIMIT,
	resolveNativeBridge,
	type NativeNotification
} from '../shared/utils/native-bridge'
import { runNativeBridgeContract } from './native-bridge-contract'

// Mirrors what desktop/src-tauri/src/bridge.rs freezes onto the remote page. The same
// scenarios run against this shape here and against the real object in `desktop:check`.
function desktopCandidate(calls: boolean[] = [], shown: NativeNotification[] = []) {
	let foreground = true
	let listener: ((value: boolean) => void) | null = null
	return {
		desktopVersion: '0.1.0-alpha.1',
		bridgeVersion: 1,
		capabilities: ['voice-lifecycle', 'notifications', 'window-focus'],
		setVoiceActive: (active: boolean) => {
			calls.push(active)
		},
		showNotification: (notification: NativeNotification) => {
			shown.push(notification)
		},
		isForeground: () => foreground,
		onForegroundChange: (next: (value: boolean) => void) => {
			listener = next
			return () => {
				listener = null
			}
		},
		// what the shell does when the member hides the window to the tray
		hide: () => {
			foreground = false
			listener?.(false)
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

		expect(Object.keys(bridge)).toEqual([
			'descriptor',
			'isDesktop',
			'supports',
			'setVoiceActive',
			'showNotification',
			'isForeground',
			'onForegroundChange'
		])
		expect(bridge.showNotification({ title: 'Данил', body: 'привет' })).toBe(false)
		expect(reached).toEqual([])
	})
})

describe('Native Bridge notifications', () => {
	test('hands the shell a title and a body and nothing else', () => {
		const shown: NativeNotification[] = []
		const bridge = resolveNativeBridge(desktopCandidate([], shown))

		expect(bridge.showNotification({ title: 'Данил', body: 'привет' })).toBe(true)

		expect(shown).toEqual([{ title: 'Данил', body: 'привет' }])
	})

	test('trims a long message instead of refusing it', () => {
		const shown: NativeNotification[] = []
		const bridge = resolveNativeBridge(desktopCandidate([], shown))

		bridge.showNotification({
			title: 'Д'.repeat(NOTIFICATION_TITLE_LIMIT + 40),
			body: 'п'.repeat(NOTIFICATION_BODY_LIMIT + 40)
		})

		expect(shown[0]?.title).toHaveLength(NOTIFICATION_TITLE_LIMIT)
		expect(shown[0]?.body).toHaveLength(NOTIFICATION_BODY_LIMIT)
	})

	test('cuts at the limit without splitting an emoji in half', () => {
		const shown: NativeNotification[] = []
		const bridge = resolveNativeBridge(desktopCandidate([], shown))
		// The 81st code unit is the tail of a surrogate pair: cutting by UTF-16 unit would
		// leave a lone surrogate, and the descriptor's own `encodeURIComponent` would throw
		// on it — a notification nobody ever sees and nobody can explain.
		const title = `${'а'.repeat(NOTIFICATION_TITLE_LIMIT - 1)}😀`

		bridge.showNotification({ title, body: `${'п'.repeat(NOTIFICATION_BODY_LIMIT - 1)}🎉` })

		expect([...(shown[0]?.title ?? '')]).toHaveLength(NOTIFICATION_TITLE_LIMIT)
		expect(shown[0]?.title.endsWith('😀')).toBe(true)
		expect([...(shown[0]?.body ?? '')]).toHaveLength(NOTIFICATION_BODY_LIMIT)
		expect(() => encodeURIComponent(shown[0]!.title)).not.toThrow()
		expect(() => encodeURIComponent(shown[0]!.body)).not.toThrow()
	})

	test('a message with no text at all is a caller bug, not a blank toast', () => {
		const shown: NativeNotification[] = []
		const bridge = resolveNativeBridge(desktopCandidate([], shown))

		expect(() => bridge.showNotification({ title: '  \n ', body: 'привет' })).toThrow(TypeError)

		expect(shown).toEqual([])
	})

	test('an attachment with no message still notifies', () => {
		const shown: NativeNotification[] = []
		const bridge = resolveNativeBridge(desktopCandidate([], shown))

		bridge.showNotification({ title: 'Данил', body: '' })

		expect(shown).toEqual([{ title: 'Данил', body: '' }])
	})
})

describe('Native Bridge window focus', () => {
	test('reports the shell answer, not the page one', () => {
		const candidate = desktopCandidate()
		const bridge = resolveNativeBridge(candidate)
		const seen: boolean[] = []
		const unsubscribe = bridge.onForegroundChange((foreground) => seen.push(foreground))

		expect(bridge.isForeground()).toBe(true)
		candidate.hide()

		expect(bridge.isForeground()).toBe(false)
		expect(seen).toEqual([false])
		unsubscribe()
	})

	test('a client that cannot answer leaves the page to decide', () => {
		const bridge = resolveNativeBridge({ ...desktopCandidate(), capabilities: [] })

		expect(bridge.supports('window-focus')).toBe(false)
		expect(bridge.isForeground()).toBe(true)
		expect(() => bridge.onForegroundChange(() => {})()).not.toThrow()
	})
})
