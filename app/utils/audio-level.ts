// One microphone level scale, shared by the settings meter and the noise gate.
//
// The gate's threshold is a point on this scale, so the two MUST agree: the UI converts a
// 0–100 threshold to a raw RMS here and hands *that* to the worklet, which then only ever
// compares RMS against RMS. No copy of this curve exists on the audio thread, so the marker
// under the meter always means what the gate actually does.

// Level 0 is this dBFS floor. The scale is logarithmic on purpose: speech lands around
// -25…-10 dBFS and a noise-suppressed room floor around -55…-45, which a linear RMS scale
// squeezes into the bottom few percent — unusable for placing a threshold.
const FLOOR_DB = -70

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value))
}

/** RMS (0–1) → the 0–100 scale shown in the UI. */
export function rmsToLevel(rms: number): number {
	if (rms <= 0) return 0
	const db = 20 * Math.log10(rms)
	return Math.round(clamp(((db - FLOOR_DB) / -FLOOR_DB) * 100, 0, 100))
}

/** Inverse of `rmsToLevel`, for handing a slider position to the gate. 0 means "never gate". */
export function levelToRms(level: number): number {
	if (level <= 0) return 0
	const db = FLOOR_DB + (clamp(level, 0, 100) / 100) * -FLOOR_DB
	return 10 ** (db / 20)
}

/**
 * Reads the current level (0–100) off an analyser. Owns its sample buffer so callers never
 * have to size it against `fftSize` — and so the buffer's type never crosses a signature
 * (TypedArrays are generic over their buffer since TS 5.7 and the getters are picky).
 *
 * Float, not `getByteTimeDomainData`: 8-bit samples carry ~0.3 counts of quantization noise,
 * which is ≈ -53 dBFS ≈ **level 25** on this scale — a phantom noise floor sitting right under
 * the default threshold, on the very meter used to place that threshold. The gate measures the
 * float signal and would report near 0 for the same input. On the old linear `rms * 300` scale
 * the same quantization landed near 0 and nothing was ever placed against it, so it was free
 * to be wrong; here it would silently mistune every microphone.
 */
export function createLevelReader(analyser: AnalyserNode): () => number {
	const buffer = new Float32Array(analyser.fftSize)
	return () => {
		analyser.getFloatTimeDomainData(buffer)
		let sum = 0
		for (const value of buffer) sum += value * value
		return rmsToLevel(Math.sqrt(sum / buffer.length))
	}
}
