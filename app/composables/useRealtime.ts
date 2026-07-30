import { onScopeDispose } from 'vue'

type Handler = (event: ServerEvent) => void

const handlers = new Set<Handler>()
let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let attempts = 0
let started = false

export function useRealtime() {
	const online = useState<string[]>('rt-online', () => [])
	const voice = useState<VoiceRooms>('rt-voice', () => ({}))
	const watch = useState<WatchRooms>('rt-watch', () => ({}))
	// performance.now() at the instant the current `watch` map ARRIVED. A watch
	// DTO's position is only true as of its arrival — the server resolves it at
	// send time — so anything counting forward from it must count from here, not
	// from whenever a consumer happened to notice. Reading a stale map (e.g. on
	// joining a channel long after the last broadcast) and treating it as fresh
	// puts that client permanently behind everyone else.
	const watchAt = useState<number>('rt-watch-at', () => 0)
	const connected = useState<boolean>('rt-connected', () => false)

	function dispatch(event: ServerEvent) {
		if (event.type === 'snapshot') {
			online.value = event.online
			voice.value = event.voice
			watch.value = event.watch
			watchAt.value = performance.now()
		} else if (event.type === 'presence') {
			online.value = event.online
		} else if (event.type === 'voice.state') {
			voice.value = event.voice
		} else if (event.type === 'watch.state') {
			watch.value = event.watch
			watchAt.value = performance.now()
		}
		for (const handler of handlers) handler(event)

		// Deleting a member cascades away far more than the member row: their
		// messages, their reactions on everyone else's messages, and the resolved
		// parent behind every reply that pointed at one of their messages. None of
		// that is derivable on the client — ReplyRefDto carries no authorId, and
		// `deleted: true` is computed server-side when the parent is missing — so
		// filtering the local list by authorId would trade stale messages for stale
		// quotes and reaction counts. Reuse the reconnect signal instead: one
		// refetch per view, on an action an admin takes maybe twice a year.
		if (event.type === 'member.deleted') dispatch({ type: 'resync' })
	}

	async function connect() {
		if (import.meta.server || !started) return
		try {
			const { ticket } = await $fetch('/api/ws/ticket', { method: 'POST' })
			const proto = location.protocol === 'https:' ? 'wss' : 'ws'
			const ws = new WebSocket(`${proto}://${location.host}/_ws`)
			socket = ws
			ws.onopen = () => {
				ws.send(JSON.stringify({ type: 'auth', ticket } satisfies ClientEvent))
			}
			ws.onmessage = (e) => {
				let event: ServerEvent
				try {
					event = JSON.parse(e.data as string)
				} catch {
					return
				}
				if (event.type === 'snapshot') {
					const wasReconnect = attempts > 0
					connected.value = true
					attempts = 0
					dispatch(event)
					// views refetch anything missed while offline
					if (wasReconnect) dispatch({ type: 'resync' })
					return
				}
				dispatch(event)
			}
			ws.onclose = () => {
				connected.value = false
				if (socket === ws) socket = null
				scheduleReconnect()
			}
		} catch {
			scheduleReconnect()
		}
	}

	function scheduleReconnect() {
		if (!started || reconnectTimer) return
		attempts++
		const delay = Math.min(1000 * 2 ** attempts, 15_000)
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null
			connect()
		}, delay)
	}

	function start() {
		if (started || import.meta.server) return
		started = true
		connect()
	}

	function stop() {
		started = false
		if (reconnectTimer) {
			clearTimeout(reconnectTimer)
			reconnectTimer = null
		}
		socket?.close()
		socket = null
		connected.value = false
	}

	function onEvent(handler: Handler) {
		handlers.add(handler)
		onScopeDispose(() => handlers.delete(handler), true)
	}

	function send(event: ClientEvent) {
		if (socket?.readyState === WebSocket.OPEN) {
			socket.send(JSON.stringify(event))
		}
	}

	return { online, voice, watch, watchAt, connected, start, stop, onEvent, send }
}
