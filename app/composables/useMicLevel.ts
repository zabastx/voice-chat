// One microphone meter, shared by the settings panel and the control-bar device picker.
//
// There are two possible sources and they are NOT interchangeable:
//
//   * the live gate — `useVoice().micLevel`, the real signal being transmitted. Free of any
//     extra device access, but it only exists while a noise gate is actually attached, which
//     means connected *and* in «Шумовой порог» mode (see ADR 0010).
//   * a test stream — our own getUserMedia + AnalyserNode. Works in every state, including
//     disconnected, at the cost of a second capture of a device LiveKit may already hold.
//
// The gate wins whenever it is available, so nobody opens a second stream for a number they
// could have borrowed. Both are refcounted: the settings panel and the picker can be open at
// once, and whichever closes first must not switch the other one's meter off.

let monitors = 0
let tests = 0
let stream: MediaStream | null = null
let context: AudioContext | null = null
let rafId = 0
let supersedeWatcherStarted = false

export function useMicLevel() {
	const voice = useVoice()
	const prefs = usePreferences()

	const testLevel = useState('mic-test-level', () => 0)
	// the shared stream is open — not the same as *this* consumer holding it, see `ownsTest`
	const testing = useState('mic-testing', () => false)

	// asks whether a gate is genuinely *attached*, not merely whether `micMode` says 'gate':
	// after a failed attach the mode still reads 'gate', and keying off that would show a
	// permanently flat bar in exactly the state where checking the microphone matters most
	const liveLevelAvailable = computed(() => voice.micGateActive.value)
	const level = computed(() => (liveLevelAvailable.value ? voice.micLevel.value : testLevel.value))
	const hasSignal = computed(() => liveLevelAvailable.value || testing.value)

	function openStream(): Promise<boolean> {
		return navigator.mediaDevices
			.getUserMedia({
				audio: prefs.value.micDeviceId ? { deviceId: { exact: prefs.value.micDeviceId } } : true
			})
			.then((opened) => {
				stream = opened
				context = new AudioContext()
				const analyser = context.createAnalyser()
				analyser.fftSize = 512
				context.createMediaStreamSource(opened).connect(analyser)
				// the shared reader, so this meter and the gate's threshold are the same scale
				const readLevel = createLevelReader(analyser)
				testing.value = true
				const tick = () => {
					testLevel.value = readLevel()
					rafId = requestAnimationFrame(tick)
				}
				tick()
				return true
			})
			.catch(() => {
				closeStream()
				return false
			})
	}

	function closeStream() {
		cancelAnimationFrame(rafId)
		rafId = 0
		stream?.getTracks().forEach((track) => track.stop())
		stream = null
		void context?.close()
		context = null
		testing.value = false
		testLevel.value = 0
	}

	// Per-consumer bookkeeping, so a disposed scope releases exactly what it took — and so a
	// surface can tell *its own* hold apart from the shared stream being open. `ownsTest` is
	// reactive because a panel's stop button belongs to the consumer that started the test:
	// deriving that button from the global `testing` would offer «Остановить проверку» for
	// somebody else's capture, and the click would do nothing.
	let holdsMonitor = false
	const ownsTest = ref(false)

	function setMonitoring(on: boolean) {
		if (on === holdsMonitor) return
		holdsMonitor = on
		monitors += on ? 1 : -1
		if (on && monitors === 1) voice.setMicMonitoring(true)
		else if (monitors === 0) voice.setMicMonitoring(false)
	}

	// Level reporting from the gate costs a postMessage every 50 ms, so it is opt-in.
	function startMonitoring() {
		setMonitoring(true)
	}

	function stopMonitoring() {
		setMonitoring(false)
	}

	/** Ask for a meter. Resolves to whether the caller actually got one — false means the
	 *  device refused, and the caller decides whether that is worth saying out loud. */
	async function startTest(): Promise<boolean> {
		if (ownsTest.value) return hasSignal.value
		ownsTest.value = true
		tests += 1
		// somebody else already has it open, or the gate is feeding the meter for free
		if (tests > 1 || liveLevelAvailable.value) return hasSignal.value
		return await openStream()
	}

	function stopTest() {
		if (!ownsTest.value) return
		ownsTest.value = false
		tests -= 1
		if (tests === 0) closeStream()
	}

	if (import.meta.client && !supersedeWatcherStarted) {
		supersedeWatcherStarted = true
		// detached scope: these must outlive whichever component called useMicLevel() first
		const scope = effectScope(true)
		scope.run(() => {
			// A gate attaching supersedes the test capture — hand off rather than leaving a
			// second stream on the same device running for a number nobody reads. The refcount
			// is untouched, so the test resumes by itself if the gate later detaches.
			watch(liveLevelAvailable, (isLive) => {
				if (isLive) closeStream()
				else if (tests > 0) void openStream()
			})
			// re-open on the newly chosen device; a meter still showing the old microphone is
			// worse than no meter, because it answers «этот микрофон работает?» about the wrong one
			watch(
				() => prefs.value.micDeviceId,
				() => {
					if (!stream) return
					closeStream()
					void openStream()
				}
			)
		})
		// HMR resets the flag, so without this every edit stacks another watcher on the old ones
		if (import.meta.hot) import.meta.hot.dispose(() => scope.stop())
	}

	onScopeDispose(() => {
		stopMonitoring()
		stopTest()
	})

	return {
		level,
		liveLevelAvailable,
		testing,
		ownsTest,
		hasSignal,
		startMonitoring,
		stopMonitoring,
		startTest,
		stopTest
	}
}
