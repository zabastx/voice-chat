// VK notifications (adr/0011). Unlike Telegram, the app talks to VK directly:
// the prod host reaches api.vk.ru and lp.vk.ru over IPv4, so there is no relay.
//
// Two things about VK shape this file. It answers HTTP 200 with the error in the
// body, so every call has to parse rather than check a status. And it has two
// message id spaces — `message_id` and `conversation_message_id` — either of
// which a reply may reference, so both are recorded.

const API_HOST = 'api.vk.ru'
// peer_ids on messages.send needs ≥ 5.124; this is what dev.vk.ru's console runs
const API_VERSION = '5.131'

// messages.send / the upload calls answer with these when the member has barred
// the community. All three mean the same thing for us: stop, and auto-unlink.
const BLOCKED_CODES = new Set([
	900, // user is in the community's blacklist
	901, // "can't send messages for users without permission"
	902 // blocked by the recipient's privacy settings
])

export class VkApiError extends Error {
	constructor(
		readonly code: number,
		readonly method: string,
		msg: string
	) {
		super(`vk ${method} → error ${code}: ${msg}`)
	}

	get blocked() {
		return BLOCKED_CODES.has(this.code)
	}
}

export function vkConfigured(): boolean {
	const config = useRuntimeConfig()
	return !!config.vkToken && !!config.vkGroupId
}

export async function vkApi<T>(
	method: string,
	params: Record<string, string | number>
): Promise<T> {
	const config = useRuntimeConfig()
	const res = await fetch(`https://${API_HOST}/method/${method}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${config.vkToken}`,
			'content-type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams({ ...params, v: API_VERSION } as Record<string, string>)
	})
	const json = (await res.json()) as {
		response?: T
		error?: { error_code: number; error_msg: string }
	}
	if (json.error) throw new VkApiError(json.error.error_code, method, json.error.error_msg)
	return json.response as T
}

// ─── media ────────────────────────────────────────────────────────────────────

type UploadServer = { upload_url: string }
type SavedDoc = { doc?: { owner_id: number; id: number }; type?: string }
type SavedPhoto = Array<{ owner_id: number; id: number }>

// Turn one attachment into a VK `attachment` string (`photo<owner>_<id>`), or
// null if it could not be forwarded — a failed attachment must never cost the
// recipient the message itself.
//
// Everything that is not an image goes through the document path. Two reasons,
// both from adr/0011: a community access key has no `video` right at all, and
// VK's voice messages must be OGG/OPUS at 16 kHz / 16 kbps while the recorder
// produces WebM/Opus or MP4/AAC — so a voice note arrives as a playable file
// rather than an inline waveform. Transcoding would need ffmpeg in the image;
// deliberately not taken on for a first cut.
async function uploadMedia(peerId: string, media: NotificationMedia): Promise<string | null> {
	try {
		const res = await getObject(media.objectKey)
		if (!res.ok) return null
		const blob = new Blob([await res.arrayBuffer()], { type: media.mime })

		if (media.kind === 'image') {
			const server = await vkApi<UploadServer>('photos.getMessagesUploadServer', {
				peer_id: peerId
			})
			const form = new FormData()
			form.append('photo', blob, media.filename)
			const uploaded = (await (
				await fetch(server.upload_url, { method: 'POST', body: form })
			).json()) as {
				server: number
				photo: string
				hash: string
			}
			const saved = await vkApi<SavedPhoto>('photos.saveMessagesPhoto', {
				photo: uploaded.photo,
				server: uploaded.server,
				hash: uploaded.hash
			})
			const first = saved[0]
			return first ? `photo${first.owner_id}_${first.id}` : null
		}

		const server = await vkApi<UploadServer>('docs.getMessagesUploadServer', {
			peer_id: peerId,
			type: 'doc'
		})
		const form = new FormData()
		form.append('file', blob, media.filename)
		const uploaded = (await (
			await fetch(server.upload_url, { method: 'POST', body: form })
		).json()) as {
			file: string
		}
		const saved = await vkApi<SavedDoc>('docs.save', {
			file: uploaded.file,
			title: media.filename
		})
		return saved.doc ? `doc${saved.doc.owner_id}_${saved.doc.id}` : null
	} catch (err) {
		// a blocked recipient must reach the caller so it can auto-unlink; any
		// other upload failure costs this one attachment and nothing more
		if (err instanceof VkApiError && err.blocked) throw err
		console.error('vk media upload failed', media.filename, err)
		return null
	}
}

// ─── delivery ─────────────────────────────────────────────────────────────────

type SendResult = Array<{
	peer_id: number
	message_id?: number
	conversation_message_id?: number
}>

// One recipient, one call. VK carries text and attachments together, so a
// notification is exactly one delivered message and one mapping row — none of
// Telegram's caption-vs-message juggling applies here.
async function deliver(peerId: string, payload: NotificationPayload): Promise<DeliveryResult> {
	const attachments: string[] = []
	try {
		for (const m of payload.media) {
			const attachment = await uploadMedia(peerId, m)
			if (attachment) attachments.push(attachment)
		}
	} catch (err) {
		if (err instanceof VkApiError && err.blocked) return { delivered: [], blocked: true }
		throw err
	}

	const failedMedia = payload.media.length > 0 && attachments.length === 0
	let text = payload.text ? `${payload.header}\n${payload.text}` : payload.header
	if (failedMedia) text += '\n(вложение не удалось переслать)'

	try {
		// peer_ids (plural) returns both id spaces instead of a bare message id
		const sent = await vkApi<SendResult>('messages.send', {
			peer_ids: peerId,
			random_id: Date.now(),
			// no snippet cards: preserves the SSRF/privacy posture from adr/0006
			dont_parse_links: 1,
			// VK turns a bare @name in the body into a mention of whichever VK
			// account owns that screen name — an app member called "danil" became a
			// link to an unrelated id7074907, who would also be notified. Our
			// mentions are app members and mean nothing on VK, so suppress it.
			disable_mentions: 1,
			message: text,
			...(attachments.length ? { attachment: attachments.join(',') } : {})
		})
		const row = sent[0]
		if (!row || typeof row.message_id !== 'number') return { delivered: [], blocked: false }
		return {
			delivered: [
				{ messageId: row.message_id, conversationMessageId: row.conversation_message_id }
			],
			blocked: false
		}
	} catch (err) {
		if (err instanceof VkApiError && err.blocked) return { delivered: [], blocked: true }
		console.error('vk messages.send failed', err)
		return { delivered: [], blocked: false }
	}
}

// Plain text to a member — the hints, and anything that isn't a notification.
export async function vkSend(peerId: string, text: string) {
	try {
		await vkApi('messages.send', {
			peer_ids: peerId,
			random_id: Date.now(),
			dont_parse_links: 1,
			disable_mentions: 1,
			message: text
		})
	} catch (err) {
		if (err instanceof VkApiError && err.blocked) return
		console.error('vk send failed', err)
	}
}

// Reply into a specific VK message — used for the hints, so a hint quotes the
// message it is about instead of arriving detached.
export async function vkReply(peerId: string, replyTo: number, text: string) {
	try {
		await vkApi('messages.send', {
			peer_ids: peerId,
			random_id: Date.now(),
			reply_to: replyTo,
			dont_parse_links: 1,
			message: text
		})
	} catch (err) {
		if (err instanceof VkApiError && err.blocked) return
		console.error('vk reply failed', err)
	}
}

export function registerVkTransport() {
	registerNotificationTransport({
		transport: 'vk',
		configured: vkConfigured,
		deliver
	})
}
