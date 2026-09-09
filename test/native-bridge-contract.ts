// One set of Native Bridge scenarios, run twice: against the browser adapter in
// `bun test`, and against the real Tauri adapter inside WebView2 from
// desktop/shell-check.mjs. Keeping them here — rather than in shared/ — keeps the
// contract out of the Web Release bundle; the shell check bundles this file itself.
import {
	resolveNativeBridge,
	type NativeCapability,
	type NativeBridge
} from '../shared/utils/native-bridge'

export interface ContractResult {
	name: string
	passed: boolean
	detail: string
}

interface Expected {
	/** whether the candidate under test is supposed to describe a Desktop Client */
	desktop: boolean
}

function throws(run: () => void): boolean {
	try {
		run()
		return false
	} catch (error) {
		return error instanceof TypeError
	}
}

/**
 * Runs every contract scenario against `candidate` and returns one result per
 * scenario. A scenario never throws: a failure is a `passed: false` row, so a
 * caller in a browser page can report all of them at once.
 */
export function runNativeBridgeContract(candidate: unknown, expected: Expected): ContractResult[] {
	const results: ContractResult[] = []
	const check = (name: string, run: () => string | true) => {
		try {
			const outcome = run()
			results.push({ name, passed: outcome === true, detail: outcome === true ? 'ok' : outcome })
		} catch (error) {
			results.push({ name, passed: false, detail: `бросил ${String(error)}` })
		}
	}
	const bridge = resolveNativeBridge(candidate)
	const unknownCapability = 'screen-recording' as NativeCapability

	check('сообщает, обнаружен ли Desktop Client', () => {
		if (bridge.isDesktop !== expected.desktop) return `isDesktop=${bridge.isDesktop}`
		if ((bridge.descriptor !== null) !== expected.desktop) return 'descriptor не совпал с isDesktop'
		return true
	})

	check('descriptor называет версию клиента и версию bridge', () => {
		const descriptor = bridge.descriptor
		if (!descriptor) return expected.desktop ? 'descriptor отсутствует' : true
		if (typeof descriptor.desktopVersion !== 'string' || descriptor.desktopVersion.length === 0) {
			return `desktopVersion=${String(descriptor.desktopVersion)}`
		}
		if (!Number.isInteger(descriptor.bridgeVersion) || descriptor.bridgeVersion < 1) {
			return `bridgeVersion=${String(descriptor.bridgeVersion)}`
		}
		if (!Array.isArray(descriptor.capabilities)) return 'capabilities не список'
		return true
	})

	check('descriptor нельзя переписать со страницы', () => {
		const descriptor = bridge.descriptor
		if (!descriptor) return true
		const before = descriptor.bridgeVersion
		try {
			;(descriptor as { bridgeVersion: number }).bridgeVersion = 99
			;(descriptor.capabilities as NativeCapability[]).push(unknownCapability)
		} catch {
			// strict mode rejects the write outright, which is the same guarantee
		}
		if (descriptor.bridgeVersion !== before) return 'bridgeVersion изменился'
		if (bridge.supports(unknownCapability)) return 'capabilities расширился'
		return true
	})

	check('неизвестная capability никогда не объявляется поддержанной', () =>
		bridge.supports(unknownCapability) ? 'поддержал неизвестную capability' : true
	)

	check('supports отвечает ровно по списку descriptor', () => {
		const declared = bridge.descriptor?.capabilities.includes('voice-lifecycle') ?? false
		return bridge.supports('voice-lifecycle') === declared
			? true
			: 'supports разошёлся с descriptor'
	})

	check('setVoiceActive принимает boolean в любом окружении', () => {
		bridge.setVoiceActive(true)
		bridge.setVoiceActive(false)
		return true
	})

	check('setVoiceActive отклоняет payload, который не boolean', () => {
		const bad: unknown[] = ['true', 1, 0, null, undefined, {}]
		for (const value of bad) {
			if (!throws(() => bridge.setVoiceActive(value as boolean))) return `принял ${String(value)}`
		}
		return true
	})

	check('клиент без voice capability сохраняет голос рабочим', () => {
		let calls = 0
		const older = resolveNativeBridge({
			desktopVersion: '0.0.9',
			bridgeVersion: 1,
			capabilities: [],
			setVoiceActive: () => {
				calls += 1
			}
		})
		if (!older.isDesktop) return 'старый клиент не распознан'
		if (older.supports('voice-lifecycle')) return 'объявил недоступную capability'
		older.setVoiceActive(true)
		return calls === 0 ? true : 'вызвал операцию без capability'
	})

	check('более новый bridge отдаёт только известные capabilities', () => {
		const newer = resolveNativeBridge({
			desktopVersion: '9.9.9',
			bridgeVersion: 99,
			capabilities: ['voice-lifecycle', 'teleport', 'voice-lifecycle'],
			setVoiceActive: () => {}
		})
		if (!newer.isDesktop) return 'новый клиент не распознан'
		if (!newer.supports('voice-lifecycle')) return 'потерял известную capability'
		const capabilities = newer.descriptor?.capabilities ?? []
		return capabilities.length === 1 && capabilities[0] === 'voice-lifecycle'
			? true
			: `capabilities=${capabilities.join(',')}`
	})

	check('испорченный descriptor читается как отсутствие Desktop Client', () => {
		const broken: unknown[] = [
			undefined,
			null,
			'desktop',
			42,
			{},
			{ desktopVersion: '1.0.0', bridgeVersion: 0, capabilities: [] },
			{ desktopVersion: '', bridgeVersion: 1, capabilities: [] },
			{ desktopVersion: '1.0.0', bridgeVersion: 1.5, capabilities: [] },
			{ desktopVersion: '1.0.0', bridgeVersion: 1, capabilities: 'voice-lifecycle' },
			{ desktopVersion: 'версия', bridgeVersion: 1, capabilities: [] }
		]
		for (const value of broken) {
			if (resolveNativeBridge(value).isDesktop) return `принял ${JSON.stringify(value)}`
		}
		return true
	})

	check('сбой native-операции не выходит в Web Release', () => {
		const failing: NativeBridge = resolveNativeBridge({
			desktopVersion: '1.0.0',
			bridgeVersion: 1,
			capabilities: ['voice-lifecycle'],
			setVoiceActive: () => {
				throw new Error('shell упал')
			}
		})
		failing.setVoiceActive(true)
		return true
	})

	return results
}
