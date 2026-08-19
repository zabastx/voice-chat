// Microphone noise gate, running on the audio thread.
//
// Deliberately an AudioWorklet and not a rAF/setInterval loop on the main thread: the whole
// point of the gate is to keep a hot mic quiet while the member is in a *backgrounded* tab
// (i.e. playing a game), and background tabs get their timers throttled to ~1 Hz. The audio
// thread is never throttled, and per-sample ramping comes for free.
//
// This file knows nothing about the UI's 0–100 level scale — `thresholdRms` arrives already
// converted by app/utils/audio-level.ts, so the meter and the gate cannot drift apart.
//
// Loaded by app/utils/mic-gate.ts via `audioWorklet.addModule('/mic-gate-worklet.js')`, which
// is why it lives in public/ as plain JS rather than anywhere the bundler would touch it.

// 10 ms in: fast enough not to clip the first consonant, slow enough not to click.
const ATTACK_SEC = 0.01
// 40 ms out, applied only after the hold has already expired.
const RELEASE_SEC = 0.04
// How often levels are posted to the main thread — only while monitoring is on.
const POST_INTERVAL_SEC = 0.05

class MicGateProcessor extends AudioWorkletProcessor {
	constructor(options) {
		super()
		const opts = (options && options.processorOptions) || {}
		this.enabled = opts.enabled !== false
		this.thresholdRms = opts.thresholdRms || 0
		this.holdSec = (opts.holdMs || 0) / 1000
		this.monitor = opts.monitor === true
		// start closed when gating, so a hot mic cannot leak during the first frames
		this.gain = this.enabled ? 0 : 1
		this.openUntil = 0
		this.peakRms = 0
		this.lastPost = 0
		this.stopped = false

		this.port.onmessage = (event) => {
			const data = event.data || {}
			// the graph was torn down (device switch, mode change, leaving the call): returning
			// false from process() is the only way to let the audio thread release this
			// processor, otherwise every restart would strand a live one for the whole call
			if (data.stop === true) {
				this.stopped = true
				return
			}
			if (typeof data.enabled === 'boolean') this.enabled = data.enabled
			if (typeof data.thresholdRms === 'number') this.thresholdRms = data.thresholdRms
			if (typeof data.holdMs === 'number') this.holdSec = data.holdMs / 1000
			if (typeof data.monitor === 'boolean' && data.monitor !== this.monitor) {
				this.monitor = data.monitor
				// drop whatever peak was accumulating, or reopening the settings panel would
				// report a level captured before it was closed
				this.peakRms = 0
				this.lastPost = currentTime
			}
		}
	}

	process(inputs, outputs) {
		if (this.stopped) return false

		const input = inputs[0]
		const output = outputs[0]
		if (!output || output.length === 0) return true

		const channel = input && input[0]
		// zero-length channel buffers do occur around device transitions, and would otherwise
		// divide by zero into a NaN RMS and write NaN across the whole output block
		if (!channel || channel.length === 0) {
			for (const out of output) out.fill(0)
			return true
		}

		let sum = 0
		for (let i = 0; i < channel.length; i++) sum += channel[i] * channel[i]
		const rms = Math.sqrt(sum / channel.length)

		// Any block at or above the threshold re-arms the hold, so the gate closes `holdSec`
		// after the last loud block rather than in the pauses between words.
		if (this.enabled && rms >= this.thresholdRms) this.openUntil = currentTime + this.holdSec
		const target = this.enabled ? (currentTime < this.openUntil ? 1 : 0) : 1
		const step = 1 / (sampleRate * (target > this.gain ? ATTACK_SEC : RELEASE_SEC))

		// Every channel ramps identically from the same starting gain, so the value carried
		// into the next block is whichever one the last channel finished on.
		const startGain = this.gain
		let endGain = startGain
		for (let c = 0; c < output.length; c++) {
			const out = output[c]
			const src = input[c] || channel
			let gain = startGain
			for (let i = 0; i < out.length; i++) {
				gain = target > gain ? Math.min(target, gain + step) : Math.max(target, gain - step)
				out[i] = src[i] * gain
			}
			endGain = gain
		}
		this.gain = endGain

		if (this.monitor) {
			// the PEAK block RMS over the post interval, not the mean, and that is the point:
			// the gate opens if *any* block crosses the threshold, so "bar above the marker"
			// means exactly "the gate opened during this window". A mean would sit below the
			// value the gate actually tests and make the marker lie.
			if (rms > this.peakRms) this.peakRms = rms
			if (currentTime - this.lastPost >= POST_INTERVAL_SEC) {
				this.port.postMessage({ rms: this.peakRms, open: this.gain > 0.01 })
				this.peakRms = 0
				this.lastPost = currentTime
			}
		}

		return true
	}
}

registerProcessor('mic-gate', MicGateProcessor)
