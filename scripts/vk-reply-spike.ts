// Throwaway spike: does a VK reply carry a usable reference to the bot's message?
// Answers the one open question in docs/research/vk-notifications-feasibility.md §3.
//
//   VK_TOKEN=vk1.a.… VK_GROUP_ID=123456789 VK_PEER_ID=12345 bun scripts/vk-reply-spike.ts
//
// dev.vk.ru documents `reply_message` on the message object as an untyped `object` and never
// lists its fields, and warns that the common message id "may be absent in some cases". So we
// measure: send one probe message, capture BOTH ids it comes back with, then long-poll and dump
// whatever a reply to it actually delivers.
//
// Second question, free to answer in the same run: the community settings have a «Добавить кнопку
// "Начать"» toggle (undocumented on dev.vk.ru). Does the `ref` from a vk.me?ref= link survive that
// button press, or does the button send a bare command? That decides whether linking is one tap or
// "send any message".
//
// Community setup, once (Управление → …):
//   1. Сообщения → включить, и «Настройки для бота» → «Возможности ботов» → включить,
//      и там же отметить «Добавить кнопку "Начать"»
//   2. Работа с API → Создать ключ, права: messages (add docs/photos if you extend this)
//   3. Работа с API → Long Poll API → включить. The «Версия API» dropdown there is a SEPARATE
//      knob from the `v` this script sends: it sets the shape of the delivered events, not our
//      method calls. Its 5.199 default is fine — we only need ≥ 5.103 so the message arrives
//      nested under object.message. Leave it alone.
//   4. Работа с API → Long Poll API → Типы событий → «Входящее сообщение»
//        (plus «Разрешение на сообщения» / «Запрет на сообщения» to observe allow/deny)
//   VK_GROUP_ID is the numeric community id (no minus sign). VK_PEER_ID is YOUR own user id
//   — a number, or your screen name, which the script resolves for you.
//
// Transport: VK_TRANSPORT=longpoll (default, outbound only) or =callback (inbound; needs a public
// URL, so locally: ngrok. Callback mode answers the confirmation handshake itself — pass
// VK_CONFIRMATION=<code from the settings screen>, and VK_CALLBACK_SECRET to enforce the secret.
// Both modes share the same probe/inspect/summary code, which also demonstrates VK's claim that
// the two transports deliver identical event objects.)
//
// Every raw update is appended to vk-spike-updates.jsonl so the evidence outlives the terminal.
// Delete this file once the finding lands in the ADR.

import { appendFileSync } from 'node:fs'

// bun auto-loads .env, so these can live there (it is gitignored — keep the token out of git).
// VK_API_KEY is accepted as an alias for VK_TOKEN: the community settings call it «ключ доступа».
const token = process.env.VK_TOKEN ?? process.env.VK_API_KEY
const groupId = process.env.VK_GROUP_ID
// Your own dialog. VK's peer_id is the plain user id for a personal dialog (a community would be
// -group_id, a group chat 2000000000 + chat_id). A screen name works too — utils.resolveScreenName
// accepts a community key, so we can turn `durov` into 1 without you hunting for the number.
const peerInput = process.env.VK_PEER_ID ?? process.env.VK_USER_ID
let peerId = 0
// 'longpoll' (default, outbound only) or 'callback' (inbound, needs a public URL — see runCallback)
const transport = process.env.VK_TRANSPORT === 'callback' ? 'callback' : 'longpoll'
// The `v` sent on our own method calls (NOT the community's Long Poll event version, see above).
// peer_ids on messages.send needs ≥ 5.124; 5.131 is what dev.vk.ru's own console uses, and the
// community Long Poll dropdown proves versions run at least to 5.199 if you want a newer one.
const apiVersion = process.env.VK_API_VERSION ?? '5.131'
const apiHost = process.env.VK_API_HOST ?? 'api.vk.ru'
const logFile = process.env.VK_SPIKE_LOG ?? 'vk-spike-updates.jsonl'
const linkToken = `spike-${Math.random().toString(36).slice(2, 10)}`

if (!token || !groupId || !peerInput) {
	console.error(
		'Missing config. Put these in .env (bun loads it) or pass them inline:\n' +
			'  VK_API_KEY=<community access key>   (or VK_TOKEN)\n' +
			'  VK_GROUP_ID=<numeric community id, no minus sign>\n' +
			'  VK_PEER_ID=<your own user id, or your vk.com screen name>\n' +
			'Then: bun scripts/vk-reply-spike.ts\n' +
			'See the header of this file for the community settings that must be on first.'
	)
	process.exit(1)
}

type Json = Record<string, unknown>

class VkError extends Error {
	constructor(
		readonly code: number,
		readonly method: string,
		msg: string
	) {
		super(`${method} → error ${code}: ${msg}`)
	}
}

async function vk<T>(method: string, params: Record<string, string | number>): Promise<T> {
	const body = new URLSearchParams({ ...params, v: apiVersion } as Record<string, string>)
	const res = await fetch(`https://${apiHost}/method/${method}`, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body
	})
	const json = (await res.json()) as {
		response?: T
		error?: { error_code: number; error_msg: string }
	}
	if (json.error) throw new VkError(json.error.error_code, method, json.error.error_msg)
	return json.response as T
}

// The community has every event type switched on, so most of what arrives is irrelevant here:
// typing status fires while you compose a reply, and message_reply echoes our own probe back.
// These still go to the jsonl — they are just not printed.
const noisyEvents = new Set([
	'message_typing_state',
	'message_read',
	'message_reaction_event',
	'message_reply'
])

const log = (update: Json, note: string) =>
	appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), note, update })}\n`)

const dump = (label: string, value: unknown) =>
	console.log(`${label}\n${JSON.stringify(value, null, 2)}`)

// ─── what we are measuring ────────────────────────────────────────────────────

// Filled in by sendProbe(); a reply is matched against both id spaces.
let probe: { messageId: number | null; cmid: number | null } | null = null

const findings = {
	refDelivered: null as boolean | null,
	startPressSeen: null as boolean | null,
	refSurvivedStart: null as boolean | null,
	startPayload: null as string | null,
	replyMessagePresent: null as boolean | null,
	replyHasId: null as boolean | null,
	replyHasCmid: null as boolean | null,
	idMatchedProbe: null as boolean | null,
	cmidMatchedProbe: null as boolean | null,
	fwdInsteadOfReply: null as boolean | null,
	replyKeys: [] as string[],
	repliesSeen: 0
}

type SendResult = {
	peer_id: number
	message_id?: number
	conversation_message_id?: number
	error?: unknown
}

async function sendProbe() {
	// peer_ids (not peer_id) makes messages.send return the object array with BOTH ids —
	// dev.vk.ru/ru/api/bots/development/messages: the id "can be obtained in advance by
	// calling the method messages.send with parameter peer_ids and API version not lower
	// than 5.124".
	const sent = await vk<SendResult[]>('messages.send', {
		peer_ids: peerId,
		random_id: Date.now(),
		dont_parse_links: 1,
		message:
			'СПАЙК: ответь на это сообщение через «Ответить», потом ещё раз с другого клиента. ' +
			'Скрипт покажет, что прилетело обратно.'
	})
	dump('\nmessages.send response:', sent)
	const row = sent[0]
	probe = {
		messageId: typeof row?.message_id === 'number' ? row.message_id : null,
		cmid: typeof row?.conversation_message_id === 'number' ? row.conversation_message_id : null
	}
	console.log(
		`\nProbe sent. message_id=${probe.messageId ?? '(absent)'} ` +
			`conversation_message_id=${probe.cmid ?? '(absent)'}`
	)
	console.log(
		'\n→ Now reply to that message in VK. Do it TWICE: once from the web client,\n' +
			'  once from the mobile app. Ctrl+C when done.\n'
	)
}

function inspectMessage(message: Json) {
	const reply = message.reply_message as Json | undefined
	const fwd = message.fwd_messages as unknown[] | undefined
	const ref = message.ref as string | undefined

	console.log(`\n─── message_new ${'─'.repeat(46)}`)
	console.log(
		`from_id=${message.from_id} peer_id=${message.peer_id} id=${message.id} ` +
			`cmid=${message.conversation_message_id}`
	)
	console.log(`text: ${JSON.stringify(message.text)}`)

	if (ref !== undefined) {
		console.log(`ref=${JSON.stringify(ref)} ref_source=${JSON.stringify(message.ref_source)}`)
		if (ref === linkToken) findings.refDelivered = true
	}

	// The «Начать» button sends a message on the user's behalf; VK bots conventionally get
	// {"command":"start"} in `payload`. Whether `ref` rides along with it is the open question.
	const payload = message.payload as string | undefined
	if (payload !== undefined) {
		console.log(`payload=${JSON.stringify(payload)}`)
		let command: unknown
		try {
			command = (JSON.parse(payload) as Json).command
		} catch {
			command = undefined
		}
		if (command === 'start') {
			findings.startPressSeen = true
			findings.startPayload = payload
			findings.refSurvivedStart = ref === linkToken
			console.log(
				`  ← «Начать» press. ref ${findings.refSurvivedStart ? 'CAME THROUGH' : 'did NOT come through'}` +
					` (expected ${linkToken}, got ${ref === undefined ? 'nothing' : JSON.stringify(ref)})`
			)
		}
	}

	if (reply) {
		findings.repliesSeen += 1
		findings.replyMessagePresent = true
		findings.replyKeys = Object.keys(reply)
		const rid = reply.id
		const rcmid = reply.conversation_message_id
		findings.replyHasId = typeof rid === 'number'
		findings.replyHasCmid = typeof rcmid === 'number'
		if (probe) {
			if (findings.replyHasId) findings.idMatchedProbe = rid === probe.messageId
			if (findings.replyHasCmid) findings.cmidMatchedProbe = rcmid === probe.cmid
		}
		dump('reply_message:', reply)
		const idLine = findings.replyHasId
			? `${rid} (probe ${probe?.messageId} → ${findings.idMatchedProbe ? 'MATCH' : 'mismatch'})`
			: 'ABSENT'
		const cmidLine = findings.replyHasCmid
			? `${rcmid} (probe ${probe?.cmid} → ${findings.cmidMatchedProbe ? 'MATCH' : 'mismatch'})`
			: 'ABSENT'
		console.log(
			`  keys: ${findings.replyKeys.join(', ')}\n` +
				`  id: ${idLine}\n` +
				`  conversation_message_id: ${cmidLine}`
		)
	} else if (fwd?.length) {
		findings.fwdInsteadOfReply = true
		dump('no reply_message, but fwd_messages:', fwd)
	} else {
		if (findings.replyMessagePresent === null) findings.replyMessagePresent = false
		console.log('no reply_message, no fwd_messages — plain message')
	}
}

async function handleUpdate(update: Json) {
	const type = update.type as string
	log(update, type)
	if (type === 'message_new') {
		const obj = update.object as Json
		// ≥ 5.103 nests the message under object.message; older versions put it on object itself
		inspectMessage((obj.message as Json) ?? obj)
		if (!probe) await sendProbe()
		return
	}
	if (type === 'message_allow' || type === 'message_deny') {
		dump(`\n${type}:`, update.object)
		const key = (update.object as Json | undefined)?.key
		if (type === 'message_allow') {
			if (key === linkToken) findings.refDelivered = true
			if (!probe) await sendProbe()
		}
		return
	}
	if (noisyEvents.has(type)) return
	console.log(`\n(other event: ${type})`)
}

function summary() {
	const say = (v: boolean | null) => (v === null ? 'not observed' : v ? 'YES' : 'NO')
	console.log(`\n${'═'.repeat(66)}`)
	console.log('SPIKE RESULT')
	console.log(`  replies observed:                 ${findings.repliesSeen}`)
	console.log(`  reply_message present in 1:1:     ${say(findings.replyMessagePresent)}`)
	console.log(`  reply_message.id present:         ${say(findings.replyHasId)}`)
	console.log(`  reply_message.cmid present:       ${say(findings.replyHasCmid)}`)
	console.log(`  id matched the probe:             ${say(findings.idMatchedProbe)}`)
	console.log(`  cmid matched the probe:           ${say(findings.cmidMatchedProbe)}`)
	console.log(`  fwd_messages instead of a reply:  ${say(findings.fwdInsteadOfReply)}`)
	console.log(`  ref token came back on link open: ${say(findings.refDelivered)}`)
	console.log(`  «Начать» button press observed:   ${say(findings.startPressSeen)}`)
	console.log(`  ref survived the Start press:     ${say(findings.refSurvivedStart)}`)
	if (findings.startPayload) console.log(`  Start payload: ${findings.startPayload}`)
	if (findings.replyKeys.length) {
		console.log(`  reply_message keys: ${findings.replyKeys.join(', ')}`)
	}
	console.log('')
	if (findings.refSurvivedStart === true) {
		console.log('  → Linking is one tap: vk.me?ref= + «Начать», full parity with t.me?start=.')
	} else if (findings.startPressSeen && findings.refSurvivedStart === false) {
		console.log(
			'  → Start works but drops ref — linking copy must say "отправьте любое сообщение".'
		)
	}
	if (findings.cmidMatchedProbe) {
		console.log(
			'  → Reply routing works. Key the mapping table on (peer_id, conversation_message_id).'
		)
		if (findings.idMatchedProbe === false || findings.replyHasId === false) {
			console.log('    The common message id is unusable here — store cmid, not id.')
		} else {
			console.log('    Both id spaces came back; store both, match on either (research §3).')
		}
	} else if (findings.replyMessagePresent === false) {
		console.log('  → BLOCKER: no reply reference in a 1:1 dialog. Reply-to-send needs a redesign.')
	} else {
		console.log(`  → Inconclusive. Raw updates are in ${logFile}.`)
	}
	console.log(`\n  Raw updates: ${logFile}`)
	console.log('═'.repeat(66))
}

// ─── run ──────────────────────────────────────────────────────────────────────

type LongPollServer = { key: string; server: string; ts: string }

async function main() {
	if (/^\d+$/.test(peerInput)) {
		peerId = Number(peerInput)
	} else {
		const name = peerInput.replace(/^.*vk\.(?:com|ru)\//, '').replace(/\/+$/, '')
		const resolved = await vk<{ type?: string; object_id?: number }>('utils.resolveScreenName', {
			screen_name: name
		})
		if (resolved?.type !== 'user' || typeof resolved.object_id !== 'number') {
			throw new Error(
				`VK_PEER_ID="${peerInput}" resolved to ${JSON.stringify(resolved)} — expected a user. ` +
					'Pass your own numeric id or your personal page screen name.'
			)
		}
		peerId = resolved.object_id
		console.log(`resolved ${name} → user id ${peerId}`)
	}

	console.log(
		`VK spike → transport=${transport} api=${apiHost} v=${apiVersion} ` +
			`group=${groupId} peer=${peerId}`
	)

	let allowed = false
	try {
		const check = await vk<{ is_allowed: number }>('messages.isMessagesFromGroupAllowed', {
			group_id: groupId,
			user_id: peerId
		})
		allowed = check.is_allowed === 1
	} catch (err) {
		// 27 = group authorization failed (bad or revoked token) — fail loudly on that one
		if (err instanceof VkError && err.code === 27) throw err
		console.log(`(isMessagesFromGroupAllowed failed: ${String(err)} — continuing)`)
	}
	console.log(`messages allowed from community: ${allowed}`)

	process.on('SIGINT', () => {
		summary()
		process.exit(0)
	})

	if (transport === 'callback') {
		await runCallback(allowed)
	} else {
		await runLongPoll(allowed)
	}
}

async function announceOrProbe(allowed: boolean) {
	if (allowed) {
		await sendProbe()
	} else {
		// Not allowed yet → you have to write first. That is exactly the linking flow from §1,
		// so piggyback on it and measure whether `ref` survives the round trip.
		console.log(
			`\nThe community can't message you yet (you must write first).\n` +
				`Open this link and press «Начать» — that is spike question 2:\n` +
				`  https://vk.me/club${groupId}?ref=${linkToken}\n` +
				`Expecting ref=${linkToken} to come back on message_new with the start payload.\n` +
				`No button? Turn on «Добавить кнопку "Начать"» in the bot settings and re-open the\n` +
				`link in a fresh dialog — otherwise just send any message.\n` +
				`The probe is sent automatically once your message arrives.\n`
		)
	}
}

async function runLongPoll(allowed: boolean) {
	const lp = await vk<LongPollServer>('groups.getLongPollServer', { group_id: groupId })
	let key = lp.key
	let ts = lp.ts
	const server = lp.server.startsWith('http') ? lp.server : `https://${lp.server}`
	console.log('long poll server acquired')

	await announceOrProbe(allowed)

	for (;;) {
		const url = `${server}?act=a_check&key=${key}&ts=${ts}&wait=25`
		let poll: { ts?: string; updates?: Json[]; failed?: number }
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(40_000) })
			poll = (await res.json()) as typeof poll
		} catch (err) {
			console.log(`(poll failed: ${String(err)} — retrying)`)
			continue
		}

		// failed 1 = ts outdated, 2 = key expired, 3 = both lost
		if (poll.failed === 1 && poll.ts) {
			ts = poll.ts
			continue
		}
		if (poll.failed === 2 || poll.failed === 3) {
			const fresh = await vk<LongPollServer>('groups.getLongPollServer', { group_id: groupId })
			key = fresh.key
			if (poll.failed === 3) ts = fresh.ts
			console.log(`(long poll failed:${poll.failed} — key refreshed)`)
			continue
		}

		if (poll.ts) ts = poll.ts
		for (const update of poll.updates ?? []) await handleUpdate(update)
	}
}

// ─── callback transport ───────────────────────────────────────────────────────

// Callback is the inbound model: VK POSTs each event to a public HTTPS URL. Locally that means a
// tunnel (ngrok). Note what this can and cannot prove — it exercises the whole Callback mechanism
// (confirmation handshake, secret header, event delivery, reply routing), but it says nothing about
// whether VK can reach the PROD host, which is the question that decided ADR 0006's design. Only
// pointing «Адрес» at the prod host and pressing «Подтвердить» answers that.
async function runCallback(allowed: boolean) {
	// The confirmation string is shown on the Callback settings screen. groups.getCallbackConfirmationCode
	// returns it too, but that needs the `manage` right, which a messages-only key does not have.
	let confirmation = process.env.VK_CONFIRMATION
	if (!confirmation) {
		try {
			const got = await vk<{ code: string }>('groups.getCallbackConfirmationCode', {
				group_id: groupId
			})
			confirmation = got.code
			console.log(`confirmation code fetched from the API: ${confirmation}`)
		} catch (err) {
			throw new Error(
				`Could not fetch the confirmation code (${String(err)}).\n` +
					'Copy it from Управление → Работа с API → Callback API → «Строка, которую должен\n' +
					'вернуть сервер» and pass it as VK_CONFIRMATION=<code>.'
			)
		}
	}

	const { createServer } = await import('node:http')
	const port = Number(process.env.VK_CALLBACK_PORT ?? 8787)
	const secret = process.env.VK_CALLBACK_SECRET

	const server = createServer((req, res) => {
		if (req.method !== 'POST') {
			res.writeHead(405).end('method not allowed')
			return
		}
		let body = ''
		req.on('data', (chunk) => {
			body += chunk
		})
		req.on('end', () => {
			void (async () => {
				let update: Json
				try {
					update = JSON.parse(body) as Json
				} catch {
					console.log(`(unparseable POST body: ${body.slice(0, 200)})`)
					res.writeHead(400).end('bad json')
					return
				}

				// The secret is VK's only authentication of the caller — anyone who finds the tunnel
				// URL can POST to it otherwise. Reject mismatches loudly rather than processing them.
				if (secret && update.secret !== secret) {
					console.log(`(rejected POST with wrong secret: ${JSON.stringify(update.secret)})`)
					res.writeHead(403).end('bad secret')
					return
				}

				if (update.type === 'confirmation') {
					console.log(`\n← confirmation request for group_id=${update.group_id}`)
					console.log(`→ answering ${confirmation}`)
					res.writeHead(200, { 'Content-Type': 'text/plain' }).end(confirmation)
					return
				}

				// VK retries anything that is not a plain "ok", so answer first and inspect after.
				res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
				const retry = req.headers['x-retry-counter']
				if (retry) console.log(`(X-Retry-Counter: ${String(retry)})`)
				// Must not throw out of here: an unhandled rejection inside a request handler kills
				// the server, and then the spike is over. Long poll gets this for free by unwinding
				// into main().catch; the callback path has to catch for itself.
				try {
					await handleUpdate(update)
				} catch (err) {
					console.error(`(handling ${String(update.type)} failed: ${String(err)})`)
				}
			})()
		})
	})

	await new Promise<void>((resolve) => server.listen(port, resolve))
	console.log(
		`\ncallback server listening on http://127.0.0.1:${port}` +
			`${secret ? ' (secret enforced)' : ' — VK_CALLBACK_SECRET not set, secret NOT checked'}\n` +
			`\nNow expose it and register it:\n` +
			`  1. ngrok http ${port}\n` +
			`  2. paste the https://… forwarding URL into Управление → Работа с API → Callback API → «Адрес»\n` +
			`  3. set «Секретный ключ» to the same value as VK_CALLBACK_SECRET\n` +
			`  4. press «Подтвердить» — this process answers the handshake\n` +
			`  5. Типы событий → «Входящее сообщение» (Callback has its own event-type tab,\n` +
			`     separate from the Long Poll one)\n`
	)

	await announceOrProbe(allowed)
}

main().catch((err) => {
	console.error(`\n${String(err)}`)
	if (err instanceof VkError && err.code === 901) {
		console.error(
			'901 = the user has not allowed messages from the community. Write to the community\n' +
				'first — that is the consent act per dev.vk.ru/ru/api/community-messages/getting-started.'
		)
	}
	summary()
	process.exit(1)
})
