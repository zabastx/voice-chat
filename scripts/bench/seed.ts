// Deterministic content for the memory benchmark: three channels whose contents
// stay identical across runs, so a before/after comparison measures the code
// change and not a different amount of chat.
//
//   bench-chat    text  — a long history with images, replies and reactions
//   bench-audio   text  — voice messages only (VoiceMessagePlayer decode cost)
//   bench-voice   voice — an empty room, for the call scenarios
//
// Seeding is idempotent: the marker in .data/bench/seed.json records what was
// created, and a second run is a no-op unless --force.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { BrowserContext } from 'playwright-core'

import { listChannels, stateDir } from './harness.ts'

export interface BenchChannels {
	chat: string
	audio: string
	voice: string
}

/** Channel names are part of the contract: the bench looks rows up by name, both
 *  in the API and (for the voice room, whose sidebar row is a button rather than a
 *  link) in the sidebar itself. */
export const benchChannelNames = {
	chat: 'bench-chat',
	audio: 'bench-audio',
	voice: 'bench-voice'
} as const

export interface SeedOptions {
	messages: number
	images: number
	voiceNotes: number
	voiceSeconds: number
	force: boolean
}

export const defaultSeed: SeedOptions = {
	messages: 220,
	images: 16,
	voiceNotes: 8,
	voiceSeconds: 30,
	force: false
}

const markerPath = join(stateDir, 'seed.json')
const MARKER_VERSION = 1

interface Marker {
	version: number
	channels: BenchChannels
	options: Omit<SeedOptions, 'force'>
}

// --- synthetic files --------------------------------------------------------

/** A mono 48 kHz 16-bit WAV. Decoded in the browser this is 4 bytes per sample
 *  per channel — which is the whole point of the bench-audio scenario. */
function makeWav(seconds: number, seed: number): Buffer {
	const rate = 48_000
	const samples = rate * seconds
	const data = Buffer.alloc(samples * 2)
	for (let i = 0; i < samples; i++) {
		// a slow sweep plus a little noise, so the waveform has visible structure
		const t = i / rate
		const freq = 180 + 120 * Math.sin((t + seed) * 0.7)
		const value = Math.sin(2 * Math.PI * freq * t) * 0.5 + (Math.random() - 0.5) * 0.05
		data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(value * 32767))), i * 2)
	}

	const header = Buffer.alloc(44)
	header.write('RIFF', 0)
	header.writeUInt32LE(36 + data.length, 4)
	header.write('WAVE', 8)
	header.write('fmt ', 12)
	header.writeUInt32LE(16, 16) // PCM chunk size
	header.writeUInt16LE(1, 20) // format: PCM
	header.writeUInt16LE(1, 22) // channels
	header.writeUInt32LE(rate, 24)
	header.writeUInt32LE(rate * 2, 28) // byte rate
	header.writeUInt16LE(2, 32) // block align
	header.writeUInt16LE(16, 34) // bits per sample
	header.write('data', 36)
	header.writeUInt32LE(data.length, 40)
	return Buffer.concat([header, data])
}

/** A photo-sized JPEG of noise — incompressible enough to weigh like a real
 *  upload, so the server writes a real 640px WebP preview for it. */
async function makeJpeg(index: number): Promise<Buffer> {
	const { default: sharp } = await import('sharp')
	const width = 1600
	const height = 900
	const raw = Buffer.alloc(width * height * 3)
	for (let i = 0; i < raw.length; i += 3) {
		const band = Math.floor((i / 3 / width / height) * 255)
		raw[i] = (band + index * 40) % 256
		raw[i + 1] = Math.floor(Math.random() * 256)
		raw[i + 2] = (i * 7 + index) % 256
	}
	return await sharp(raw, { raw: { width, height, channels: 3 } })
		.jpeg({ quality: 80 })
		.toBuffer()
}

// --- api helpers ------------------------------------------------------------

async function ensureChannel(
	context: BrowserContext,
	name: string,
	kind: 'text' | 'voice'
): Promise<string> {
	const existing = (await listChannels(context)).find((c) => c.name === name)
	if (existing) return existing.id
	const res = await context.request.post('/api/channels', { data: { name, kind } })
	if (!res.ok()) throw new Error(`create #${name} → ${res.status()} ${await res.text()}`)
	return ((await res.json()) as { id: string }).id
}

async function upload(
	context: BrowserContext,
	name: string,
	mimeType: string,
	buffer: Buffer
): Promise<string> {
	const res = await context.request.post('/api/attachments', {
		multipart: { file: { name, mimeType, buffer } }
	})
	if (!res.ok()) throw new Error(`upload ${name} → ${res.status()} ${await res.text()}`)
	return ((await res.json()) as { id: string }).id
}

async function post(
	context: BrowserContext,
	channelId: string,
	content: string,
	attachmentIds: string[] = [],
	replyToId?: string
): Promise<string> {
	const res = await context.request.post(`/api/channels/${channelId}/messages`, {
		data: { content, attachmentIds, replyToId }
	})
	if (!res.ok()) throw new Error(`post → ${res.status()} ${await res.text()}`)
	return ((await res.json()) as { id: string }).id
}

// --- seeding ----------------------------------------------------------------

const LINES = [
	'Ну что, погнали тестировать',
	'у меня вчера опять всё зависло на середине созвона',
	'`docker compose up -d` и вперёд',
	'кто-нибудь смотрел логи за вчера?',
	'**важно**: не забудьте про миграцию',
	'ага, я тоже это видел',
	'проверил — воспроизводится только в хроме',
	'ладно, вечером посмотрю',
	'сделал, залил, работает',
	'а вот тут интересный момент с памятью',
	'думаю это из-за подписки на треки',
	'хорошо, тогда так и оставим'
]

export async function seed(context: BrowserContext, options: SeedOptions): Promise<BenchChannels> {
	mkdirSync(stateDir, { recursive: true })

	const channels: BenchChannels = {
		chat: await ensureChannel(context, benchChannelNames.chat, 'text'),
		audio: await ensureChannel(context, benchChannelNames.audio, 'text'),
		voice: await ensureChannel(context, benchChannelNames.voice, 'voice')
	}

	if (!options.force && existsSync(markerPath)) {
		const marker = JSON.parse(readFileSync(markerPath, 'utf8')) as Marker
		const sameChannels = (['chat', 'audio', 'voice'] as const).every(
			(key) => marker.channels[key] === channels[key]
		)
		if (marker.version === MARKER_VERSION && sameChannels) {
			console.log('seed: already present (--force to seed again)')
			return channels
		}
	}

	console.log(`seed: ${options.messages} messages + ${options.images} images → #bench-chat`)
	const imageEvery = Math.max(1, Math.floor(options.messages / Math.max(1, options.images)))
	let firstId: string | undefined
	for (let i = 0; i < options.messages; i++) {
		const line = `${LINES[i % LINES.length]} (${i + 1})`
		let attachmentIds: string[] = []
		if (options.images > 0 && i % imageEvery === imageEvery - 1) {
			attachmentIds = [await upload(context, `bench-${i}.jpg`, 'image/jpeg', await makeJpeg(i))]
		}
		// every 9th message quotes an earlier one, so replies render in the window too
		const replyToId = firstId && i % 9 === 8 ? firstId : undefined
		const id = await post(context, channels.chat, line, attachmentIds, replyToId)
		firstId ??= id
		// a handful of reactions — they add a tooltip-wrapped button per emoji
		if (i % 7 === 0) {
			await context.request.post(`/api/messages/${id}/reactions`, { data: { emoji: '👍' } })
		}
		if (i % 20 === 0) process.stdout.write(`\r  ${i + 1}/${options.messages}`)
	}
	process.stdout.write('\r')

	console.log(`seed: ${options.voiceNotes} × ${options.voiceSeconds}s voice notes → #bench-audio`)
	for (let i = 0; i < options.voiceNotes; i++) {
		// the `voice-message-` prefix is what MessageAttachments keys the waveform
		// player off — without it the browser gets a plain <audio> element
		const name = `voice-message-${Date.now()}-${i}.wav`
		const id = await upload(context, name, 'audio/wav', makeWav(options.voiceSeconds, i))
		await post(context, channels.audio, '', [id])
	}

	const marker: Marker = {
		version: MARKER_VERSION,
		channels,
		options: {
			messages: options.messages,
			images: options.images,
			voiceNotes: options.voiceNotes,
			voiceSeconds: options.voiceSeconds
		}
	}
	writeFileSync(markerPath, JSON.stringify(marker, null, 2))
	console.log('seed: done')
	return channels
}

/** Channel ids for a run — from the marker when present, else by name lookup. */
export async function benchChannels(context: BrowserContext): Promise<BenchChannels> {
	const byName = await listChannels(context)
	const find = (name: string) => byName.find((c) => c.name === name)?.id
	const chat = find(benchChannelNames.chat)
	const audio = find(benchChannelNames.audio)
	const voice = find(benchChannelNames.voice)
	if (!chat || !audio || !voice) {
		throw new Error('bench channels missing — run `bun run bench:seed` first')
	}
	return { chat, audio, voice }
}
