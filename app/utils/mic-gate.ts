// The noise gate as a LiveKit TrackProcessor — the same extension point Krisp uses.
//
// Going through `LocalAudioTrack.setProcessor()` rather than publishing a hand-built track is
// what keeps `setMicrophoneEnabled`, `switchActiveDevice` (LiveKit calls `restart` for us) and
// the mute path working untouched; a custom publish would mean reimplementing all three.
//
// The gate is invisible to everyone else: it is never relayed over the WS hub, the way local
// volume never is (ADR 0003). Other members simply hear nothing, and the speaking ring keeps
// coming from LiveKit's own `ActiveSpeakersChanged` for free.

import type { AudioProcessorOptions, Track, TrackProcessor } from 'livekit-client'

export interface MicGateSettings {
	enabled: boolean
	/** already on the raw RMS scale — converted from the UI's 0–100 by `levelToRms` */
	thresholdRms: number
	holdMs: number
}

export interface MicGate extends TrackProcessor<Track.Kind.Audio, AudioProcessorOptions> {
	update(next: Partial<MicGateSettings>): void
	/** level reporting costs a postMessage per 50 ms, so it stays off outside the settings panel */
	setMonitor(on: boolean): void
	onLevel: ((level: number, open: boolean) => void) | null
}

const WORKLET_URL = '/mic-gate-worklet.js'

// `addModule` evaluates the module in the context's global scope, so calling it twice for the
// same context would run `registerProcessor('mic-gate')` again and throw. Cache per context.
const workletReady = new WeakMap<BaseAudioContext, Promise<void>>()

function loadWorklet(context: AudioContext): Promise<void> {
	let ready = workletReady.get(context)
	if (!ready) {
		// Only a *fulfilled* load stays cached. Memoising a rejection would poison this context
		// for the rest of the call — the context belongs to the Room, so one transient failure
		// fetching the module (dev-server restart, a 502, an offline blip) would leave the gate
		// permanently unavailable until the member left and rejoined the channel.
		ready = context.audioWorklet.addModule(WORKLET_URL).catch((error: unknown) => {
			workletReady.delete(context)
			throw error
		})
		workletReady.set(context, ready)
	}
	return ready
}

/**
 * Warm the module into the HTTP cache. The gate can only be attached *after* LiveKit has
 * published the mic, so the module fetch would otherwise sit inside the window where the
 * member is already transmitting ungated; called at the top of `join()` it overlaps the
 * connect round-trip instead.
 */
export function prefetchMicGateWorklet(): void {
	void fetch(WORKLET_URL, { cache: 'force-cache' }).catch(() => {
		// a cold cache just means the real addModule pays for the fetch, as before
	})
}

// The source + worklet node get rebuilt on every restart; the destination deliberately does
// not — see init().
interface GateStage {
	source: MediaStreamAudioSourceNode
	node: AudioWorkletNode
}

function disposeStage(stage: GateStage | null) {
	if (!stage) return
	// queued before the port closes, so it still arrives; without it the processor keeps
	// returning true and the audio thread never releases it
	stage.node.port.postMessage({ stop: true })
	stage.node.port.onmessage = null
	stage.source.disconnect()
	stage.node.disconnect()
}

export function createMicGate(initial: MicGateSettings): MicGate {
	let context: AudioContext | null = null
	let destination: MediaStreamAudioDestinationNode | null = null
	let stage: GateStage | null = null
	let settings: MicGateSettings = { ...initial }
	let monitor = false
	let destroyed = false

	function createDestination(ctx: AudioContext): MediaStreamAudioDestinationNode {
		// Mono, explicitly. A MediaStreamDestination defaults to 2 channels, and on a reconnect
		// LiveKit re-reads `channelCount` off the *processed* track to decide whether to publish
		// stereo Opus — which forces `dtx: false` and `red: false`, i.e. roughly double the
		// upstream on a mono microphone and the loss of the idle-silence saving the gate exists
		// to give, precisely when the connection is already in trouble.
		if (typeof MediaStreamAudioDestinationNode === 'function') {
			return new MediaStreamAudioDestinationNode(ctx, {
				channelCount: 1,
				channelCountMode: 'explicit'
			})
		}
		return ctx.createMediaStreamDestination()
	}

	const gate: MicGate = {
		name: 'mic-gate',
		processedTrack: undefined,
		onLevel: null,

		async init(opts) {
			// `LocalAudioTrack.setProcessor` throws unless the track already carries an
			// AudioContext, so one is always supplied on the first call — but LiveKit omits it
			// from the options it hands to `restart()`, which is why the first one is kept.
			const ctx = context ?? (opts.audioContext as AudioContext | undefined) ?? null
			if (!ctx) throw new Error('mic gate: no AudioContext supplied')
			context = ctx

			if (ctx.state === 'suspended') await ctx.resume()
			await loadWorklet(ctx)
			// destroy() can land while those awaits are outstanding (a disconnect during the
			// first attach). Without this the build below runs against a torn-down gate and
			// throws deeper in, reporting an attach failure for a gate nobody is waiting on.
			if (destroyed || context !== ctx) throw new Error('mic gate: torn down during init')

			const source = ctx.createMediaStreamSource(new MediaStream([opts.track]))
			const node = new AudioWorkletNode(ctx, 'mic-gate', {
				processorOptions: { ...settings, monitor }
			})
			node.port.onmessage = (event: MessageEvent<{ rms: number; open: boolean }>) => {
				gate.onLevel?.(rmsToLevel(event.data.rms), event.data.open)
			}

			// The destination — and therefore `processedTrack` — survives a restart. Building a
			// fresh one per device switch would leave the previous MediaStreamTrack live for the
			// rest of the call (LiveKit only ever stops the processedTrack it currently holds),
			// and stopping it here instead would briefly leave the RTP sender on a dead track,
			// since LiveKit does not call replaceTrack until after restart() returns.
			if (!destination) destination = createDestination(ctx)

			const previous = stage
			source.connect(node).connect(destination)
			stage = { source, node }
			gate.processedTrack = destination.stream.getAudioTracks()[0]
			// only once the replacement is already feeding the destination
			disposeStage(previous)
		},

		// called by LiveKit when the underlying device changes mid-call
		async restart(opts) {
			await gate.init(opts)
		},

		async destroy() {
			destroyed = true
			disposeStage(stage)
			stage = null
			destination?.disconnect()
			for (const track of destination?.stream.getAudioTracks() ?? []) track.stop()
			destination = null
			gate.processedTrack = undefined
			// the AudioContext belongs to LiveKit's Room, which closes it on disconnect
			context = null
		},

		update(next) {
			settings = { ...settings, ...next }
			stage?.node.port.postMessage(settings)
		},

		setMonitor(on) {
			monitor = on
			stage?.node.port.postMessage({ monitor: on })
		}
	}

	return gate
}
