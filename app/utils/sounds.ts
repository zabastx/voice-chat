// Short synthesized notification tones — no audio assets needed.

let ctx: AudioContext | undefined

function ensureContext() {
	if (import.meta.server) return false
	ctx ??= new AudioContext()
	if (ctx.state === 'suspended') {
		// resume works only after a user gesture; failing silently is fine
		ctx.resume().catch(() => {})
	}
	return ctx.state === 'running'
}

function tone(frequency: number, startOffset: number, duration: number, volume = 0.06) {
	if (!ctx) return
	const start = ctx.currentTime + startOffset
	const osc = ctx.createOscillator()
	const gain = ctx.createGain()
	osc.type = 'sine'
	osc.frequency.value = frequency
	gain.gain.setValueAtTime(0, start)
	gain.gain.linearRampToValueAtTime(volume, start + 0.015)
	gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
	osc.connect(gain)
	gain.connect(ctx.destination)
	osc.start(start)
	osc.stop(start + duration + 0.05)
}

export function playMessageSound() {
	if (!ensureContext()) return
	tone(830, 0, 0.1)
	tone(1100, 0.07, 0.12)
}

export function playMentionSound() {
	if (!ensureContext()) return
	tone(880, 0, 0.12)
	tone(1320, 0.09, 0.14)
	tone(1760, 0.18, 0.16)
}

export function playJoinSound() {
	if (!ensureContext()) return
	tone(440, 0, 0.12)
	tone(660, 0.1, 0.16)
}

export function playLeaveSound() {
	if (!ensureContext()) return
	tone(660, 0, 0.12)
	tone(440, 0.1, 0.16)
}
