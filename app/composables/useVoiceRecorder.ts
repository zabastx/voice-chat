// Records a short audio clip via MediaRecorder for sending as a voice message.
// Кодек зависит от браузера (webm/opus в Chromium, mp4 в Safari) — выбираем
// первый поддерживаемый контейнер, decodeAudioData на приёме разберёт оба.
const MAX_SECONDS = 300 // ~5 минут — с запасом под лимит вложения в 25 МБ

const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']

function pickMimeType() {
	if (typeof MediaRecorder === 'undefined') return ''
	return CANDIDATE_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? ''
}

// onComplete fires once recording is finalized — via stop() or the max-length auto-stop
export function useVoiceRecorder(onComplete: (blob: Blob) => void) {
	const toast = useToast()
	const prefs = usePreferences()

	const recording = ref(false)
	const elapsed = ref(0) // секунды

	let recorder: MediaRecorder | null = null
	let stream: MediaStream | null = null
	let chunks: Blob[] = []
	let timer: ReturnType<typeof setInterval> | null = null

	function releaseStream() {
		stream?.getTracks().forEach((track) => track.stop())
		stream = null
	}

	function clearTimer() {
		if (timer) clearInterval(timer)
		timer = null
	}

	function reset() {
		clearTimer()
		releaseStream()
		recorder = null
		chunks = []
		recording.value = false
		elapsed.value = 0
	}

	async function start() {
		if (recording.value) return
		try {
			stream = await navigator.mediaDevices.getUserMedia({
				audio: prefs.value.micDeviceId ? { deviceId: { exact: prefs.value.micDeviceId } } : true
			})
		} catch {
			toast.add({
				title: 'Не удалось получить доступ к микрофону',
				description: 'Разрешите доступ в настройках браузера и попробуйте снова.',
				color: 'error',
				icon: 'i-lucide-mic-off'
			})
			releaseStream()
			return
		}

		chunks = []
		const mimeType = pickMimeType()
		recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
		recorder.ondataavailable = (e) => {
			if (e.data.size > 0) chunks.push(e.data)
		}
		recorder.start()
		recording.value = true
		elapsed.value = 0
		timer = setInterval(() => {
			elapsed.value += 1
			if (elapsed.value >= MAX_SECONDS) stop()
		}, 1000)
	}

	function finalize() {
		const type = recorder?.mimeType || 'audio/webm'
		const blob = new Blob(chunks, { type })
		reset()
		if (blob.size > 0) onComplete(blob)
	}

	// Stop recording; the collected clip is delivered through onComplete.
	function stop() {
		if (!recorder || recorder.state === 'inactive') return
		recorder.onstop = finalize
		clearTimer()
		recorder.stop()
		recording.value = false
	}

	function cancel() {
		if (recorder && recorder.state !== 'inactive') {
			recorder.onstop = null
			recorder.stop()
		}
		reset()
	}

	onScopeDispose(cancel)

	return { recording, elapsed, start, stop, cancel }
}
