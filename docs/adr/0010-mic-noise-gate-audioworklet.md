# 0010 — The microphone noise gate runs in an AudioWorklet, client-side only

Date: 2026-07-31
Status: accepted

## Context

Voice was open-mic from v1. [decisions.md](../progress/decisions.md) called it "voice-activity
detection (no push-to-talk)", but that overstates what was there: LiveKit's
`ActiveSpeakersChanged` is a _display_ signal — the SFU computes who is loudest so the UI can
draw the speaking ring. Nothing ever gated transmission. Every member's mic was a permanently
hot line, and for an audience that games while talking, what went down it was mechanical
keyboards, fans, and other people in the room.

The browser-level cleanup was already maxed out and is not the answer: livekit-client's
`audioDefaults` turns on `echoCancellation`, `noiseSuppression`, `autoGainControl` and
`voiceIsolation`, and `Room` re-merges those over any `audioCaptureDefaults` we pass (so
picking a specific microphone in settings does _not_ silently drop them, which was the first
suspicion). Suppression attenuates steady noise; it does not decide when you are not talking.

Push-to-talk is the other obvious answer and is deliberately **not** part of this decision:
`keydown`/`keyup` only fire while the document has focus, so a member in a fullscreen game
never presses the key as far as the browser is concerned. PTT needs an OS-level hotkey, i.e.
the deferred desktop wrapper or a companion helper. The gate, by contrast, is pure in-page
audio processing and works exactly as well in a backgrounded tab.

## Options considered

1. **Server/SFU-side gating** — would need per-member audio analysis on the SFU, is not
   something LiveKit offers as a knob, and burns CPU on a box that exists to forward packets.
   Rejected.
2. **Toggle `setMicrophoneEnabled` from a level watcher** — no new audio graph, but every
   transition is a mute/unmute round trip through the signalling channel (one per syllable),
   it fights the member's own explicit Self-Mute state, and it clicks.
3. **A Web Audio gain stage driven from a main-thread rAF/`setInterval` loop** — right shape,
   wrong thread. Background tabs get their timers throttled to ~1 Hz; a tab in a WebRTC call
   is normally exempt from the intensive tier, but "normally exempt" is a bet on browser
   heuristics, and the tab being hidden _is_ the target scenario.
4. **A gain stage driven from an AudioWorklet** — runs on the audio thread, which is never
   throttled, and gets sample-accurate ramping for free. Chosen.

## Decision

The gate is a `TrackProcessor` ([mic-gate.ts](../../app/utils/mic-gate.ts)) attached to the
published microphone track via `LocalAudioTrack.setProcessor()` — the same extension point
Krisp uses. Going through the processor API rather than publishing a hand-built track is what
keeps `setMicrophoneEnabled`, `switchActiveDevice` and the mute path working untouched;
LiveKit calls the processor's `restart()` itself when the device changes mid-call.

The graph is `source → mic-gate worklet → MediaStreamDestination`, and the destination's track
is what gets published. [mic-gate-worklet.js](../../public/mic-gate-worklet.js) computes RMS
per 128-sample block, holds the gate open for `gateHold` ms after the last block above the
threshold, and ramps gain per sample (10 ms in, 40 ms out) so it neither clicks nor clips the
first consonant. It lives in `public/` because `audioWorklet.addModule()` takes a URL.

**The worklet never converts between the UI's 0–100 level scale and RMS.** The single curve
lives in [audio-level.ts](../../app/utils/audio-level.ts); the app converts the threshold to a
raw RMS _once_ and hands that across, so the audio thread only ever compares RMS against RMS.
That is what makes the marker under the settings meter mean what the gate actually does — a
second copy of the curve is the one way this feature silently becomes a lie. The same module
also backs the existing mic-test meter, whose old linear `rms * 300` scale was replaced with a
dBFS one: speech sits around -25…-10 dBFS and a suppressed room floor around -55…-45, which
linear scaling crushes into the bottom few percent, leaving nowhere to put a threshold.

Sharing the curve is necessary but not sufficient — the **estimator** has to agree too, and
that is subtler:

- The in-call meter reports the **peak** block RMS over each 50 ms window, not the mean, and
  deliberately: the gate opens if _any_ block crosses the threshold, so peak is what makes
  "bar above the marker" mean exactly "the gate opened during this window". A mean would sit
  below the value the gate actually tests, and the marker would lie in the safe-looking
  direction.
- The out-of-call mic test reads floats, not `getByteTimeDomainData`. 8-bit samples carry
  enough quantization noise to put a **phantom floor around level 25** on a dBFS scale — right
  under the default threshold, on the very meter used to place it. The old linear scale mapped
  that same noise to roughly 0, which is why it was free to be wrong before and is not now.

Gate state is **never relayed** — not over the WS hub, not to the SFU, exactly as per-speaker
Local Volume is never relayed ([ADR 0003](0003-client-side-local-volume.md)). Other members
simply hear nothing while it is shut, and the speaking ring keeps coming from LiveKit for
free. Broadcasting transitions would be a WS message per syllable to say something the audio
already says.

Mode and tuning (`micMode`, `gateThreshold`, `gateHold`) live in `usePreferences`
(localStorage), per-device like every other capture preference — the right threshold is a
property of this room and this microphone, not of the account. The default stays `'open'`, so
nobody's voice changes until they opt in.

## Consequences

- No server, DB, WS or SFU work; a member can only change their own microphone.
- The gate runs on the Room's `AudioContext`, not one of its own. `Room.acquireAudioContext()`
  creates one unconditionally — the `webAudioMix` option (default false) only selects a custom
  context and only gates pushing it onto _remote_ participants — and
  `LocalAudioTrack.setProcessor()` throws outright without one, so it is always present on the
  first `init`. LiveKit does, however, omit `audioContext` from the options it passes to
  `restart()`, which is why the first one is cached for the life of the gate. Nothing here
  closes it; the Room does, on disconnect.
- **A gate handle is not proof that a gate is attached.** Enabling the microphone when nothing
  is published makes LiveKit create and publish a brand-new, unprocessed track rather than
  unmute an existing one, so every path that can publish — not just `join()` — has to re-apply
  the mode, and the attach checks `track.getProcessor()` rather than trusting the handle. The
  failure this prevents is the worst one available: transmitting wide open while the UI says
  «Шумовой порог».
- Detaching is as dangerous as attaching. `stopProcessor()` stops the processed track _before_
  restoring the raw one, so a failure partway through leaves the sender on a stopped track —
  inaudible to everyone, undetectable to its owner. Both directions are guarded, and the detach
  path re-acquires the device to repair the sender before giving up with a toast.
- The processed track is forced to **mono**. A `MediaStreamDestination` defaults to two
  channels, and on reconnect LiveKit re-reads `channelCount` from the processed track to decide
  stereo Opus, which would disable DTX and RED — costing roughly double the upstream on a mono
  mic and the exact idle-silence saving the gate is supposed to give.
- The destination node survives `restart()` while the source and worklet node are rebuilt, so
  `processedTrack` keeps its identity across device switches, wake-from-sleep and reconnects.
  Rebuilding it would strand the old `MediaStreamTrack` live for the rest of the call (LiveKit
  only ever stops the one it currently holds), and stopping it eagerly would leave the sender
  briefly pointing at a dead track, since `replaceTrack` does not happen until `restart()`
  returns. Retired worklet nodes are told to `stop`, because a processor that keeps returning
  `true` is never released.
- If the worklet fails to load, the attach is caught and the member falls back to an open mic
  with a toast, rather than being left with a half-built graph in the signal path.
- A gate shut by a too-high threshold is indistinguishable, to its owner, from a broken
  microphone. The live meter with the threshold marker and the «микрофон открыт/закрыт»
  readout in settings are the required antidote, and the meter reads the _live_ pipeline
  whenever the member is in a call rather than a second test stream.
- Level reporting costs a `postMessage` every 50 ms, so it is opt-in and only runs while the
  settings panel is open.
- Free side effect: with the gate shut, Opus DTX means near-zero upstream while silent.
- AGC pumps the noise floor up during silence, so a threshold tuned in a quiet room can drift.
  Accepted for now; the meter is the escape hatch. Exposing an AGC toggle is the next lever if
  it proves necessary.
- Push-to-talk remains unbuilt. When it lands it is a third `micMode` driving the _same_
  worklet gain, not a second mechanism.
