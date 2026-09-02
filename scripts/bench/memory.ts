// Client memory benchmark — how much RAM the app costs the browser, per scenario.
//
//   node scripts/bench/memory.ts seed [--force]
//   node scripts/bench/memory.ts run --label before [--only chat|call|all] [--headed]
//   node scripts/bench/memory.ts compare before after
//
// (bun runs it too, but node is the tested path — playwright drives Chrome over a
// pipe, and that is node's home turf.)
//
// Measurement is OS-level on purpose: the things we want to see — WebRTC decode
// buffers, decoded AudioBuffers, image bitmaps — are not on the JS heap, so a
// `performance.memory` reading would miss almost all of it. `privateTotal` is the
// private commit of the whole Chrome process tree; the JS-heap and DOM counters
// come along as supporting evidence.
//
// Compare like with like: same build mode (a dev server carries HMR, source maps
// and unminified chunks), same seeded content, same machine, nothing else running.
//
// The call scenarios need the app on **port 3000**: the voice roster is drawn from
// LiveKit webhooks, and livekit.dev.yaml posts them to host.docker.internal:3000.
// On any other port the call view stays empty — media still flows, but no tile is
// ever rendered, so there is nothing to measure.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Page } from 'playwright-core'

import {
	launchBrowser,
	listChannels,
	measure,
	openChannel,
	repoRoot,
	signIn,
	sleep,
	stateDir,
	type Measurement
} from './harness.ts'
import { benchChannelNames, benchChannels, defaultSeed, seed, type BenchChannels } from './seed.ts'

const resultsDir = join(stateDir, 'results')

interface ScenarioResult {
	name: string
	description: string
	measurement: Measurement
	notes: Record<string, number | string | boolean>
}

interface RunReport {
	label: string
	startedAt: string
	baseUrl: string
	mode: 'dev' | 'production' | 'unknown'
	appVersion: string
	git: { commit: string; dirty: boolean }
	headless: boolean
	scenarios: ScenarioResult[]
}

// --- cli --------------------------------------------------------------------

interface Args {
	command: string
	label: string
	base: string
	only: string
	headed: boolean
	force: boolean
	rest: string[]
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		command: argv[0] ?? 'run',
		label: 'run',
		base: process.env.BENCH_BASE ?? 'http://localhost:3000',
		only: 'all',
		headed: false,
		force: false,
		rest: []
	}
	for (let i = 1; i < argv.length; i++) {
		const arg = argv[i]!
		if (arg === '--label') args.label = argv[++i] ?? args.label
		else if (arg === '--base') args.base = argv[++i] ?? args.base
		else if (arg === '--only') args.only = argv[++i] ?? args.only
		else if (arg === '--headed') args.headed = true
		else if (arg === '--force') args.force = true
		else args.rest.push(arg)
	}
	return args
}

// --- page driving -----------------------------------------------------------

async function waitFor(
	page: Page,
	expression: string,
	predicate: (value: number) => boolean,
	timeoutMs = 30_000
): Promise<number> {
	const deadline = Date.now() + timeoutMs
	let last = 0
	while (Date.now() < deadline) {
		last = (await page.evaluate(expression)) as number
		if (predicate(last)) return last
		await sleep(500)
	}
	return last
}

const COUNT_MESSAGES = 'document.querySelectorAll("[data-message-id]").length'
// A voice note draws its waveform only once the clip is decoded — one inline-height
// div per bar (BARS = 48 in VoiceMessagePlayer). Counting bars says how many players
// actually finished decoding, which is the thing this scenario is about.
const COUNT_PLAYERS = 'Math.floor(document.querySelectorAll(\'div[style*="height:"]\').length / 48)'
const COUNT_LIVE_VIDEO =
	'Array.from(document.querySelectorAll("video")).filter(v => v.videoWidth > 0).length'
// LiveKit attaches remote audio straight to <body>, so this survives leaving the call view
const COUNT_ROOM_AUDIO = 'document.querySelectorAll("body > audio").length'

/**
 * Scroll the history to the top until the rendered window stops growing — that is
 * what puts a full RENDER_CAP of rows (and their images) in the DOM at once.
 */
async function fillHistory(page: Page): Promise<number> {
	let previous = -1
	for (let i = 0; i < 20; i++) {
		const count = (await page.evaluate(COUNT_MESSAGES)) as number
		if (count === previous) break
		previous = count
		await page.evaluate(`(() => {
			const anchor = document.querySelector('[data-message-id]')
			for (let el = anchor; el; el = el.parentElement) {
				const style = getComputedStyle(el)
				if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
					el.scrollTop = 0
					return
				}
			}
		})()`)
		await sleep(900)
	}
	return (await page.evaluate(COUNT_MESSAGES)) as number
}

async function clickIcon(page: Page, icon: string) {
	await page.locator(`button:has([class*="${icon}"])`).first().click()
}

/**
 * Switch channels the way a member does — clicking the sidebar link, which is a
 * client-side route change. `page.goto` would reload the document and tear down
 * the LiveKit room with it, which is exactly the state the call scenarios are
 * trying to hold on to.
 */
async function navigateInApp(page: Page, channelId: string) {
	const link = page.locator(`a[href="/channels/${channelId}"]`).first()
	if ((await link.count()) === 0) {
		await openChannel(page, channelId)
		return
	}
	await link.click()
	await page.waitForURL(`**/channels/${channelId}`)
	await page.waitForLoadState('networkidle').catch(() => {})
	await sleep(1500)
}

/**
 * Return to a voice channel from the sidebar. Voice rows are buttons, not links —
 * clicking one joins the call as well as routing — so the href lookup above can't
 * find them, and `page.goto` is out of the question: it would reload the document
 * and drop the very call this is coming back to.
 */
async function returnToVoiceChannel(page: Page, channelId: string) {
	await page.getByRole('button', { name: benchChannelNames.voice }).first().click()
	await page.waitForURL(`**/channels/${channelId}`)
	await page.waitForLoadState('networkidle').catch(() => {})
	await sleep(1500)
}

async function joinVoice(page: Page, channelId: string) {
	await openChannel(page, channelId)
	await page.getByRole('button', { name: 'Подключиться' }).click()
	// the join button is replaced by the in-call control bar
	await waitFor(
		page,
		// @nuxt/ui renders icons as `i-lucide:phone-off` — with a colon, not a dash
		'document.querySelectorAll(\'[class*="i-lucide:phone-off"]\').length',
		(n) => n > 0,
		30_000
	)
	await sleep(2000)
}

// --- scenarios --------------------------------------------------------------

// A fresh WebRTC connection keeps allocating for several seconds after the first
// frame arrives, so the call scenarios wait longer than a static page needs.
const CALL_SETTLE_MS = 9000

interface RunContext {
	base: string
	headless: boolean
	channels: BenchChannels
	/** The quietest text channel available (#general when it exists) — where the
	 *  "still in the call, reading something else" scenario goes. It is NOT empty:
	 *  #general carries whatever has been said in it, and that DOM is why the
	 *  scenario is read as a pair with `no-call-same-channel` rather than alone. */
	quiet: string
}

async function scenarioIdle(ctx: RunContext): Promise<ScenarioResult> {
	const bench = await launchBrowser({ headless: ctx.headless })
	try {
		const { page } = await signIn(bench.browser, ctx.base, 'danil', 'password123')
		await openChannel(page, ctx.quiet)
		return {
			name: 'idle',
			description: 'signed in, the quietest channel open — the floor, which is not a zero',
			measurement: await measure(page, bench.pid),
			notes: { messagesInDom: (await page.evaluate(COUNT_MESSAGES)) as number }
		}
	} finally {
		await bench.close()
	}
}

async function scenarioChat(ctx: RunContext): Promise<ScenarioResult> {
	const bench = await launchBrowser({ headless: ctx.headless })
	try {
		const { page } = await signIn(bench.browser, ctx.base, 'danil', 'password123')
		await openChannel(page, ctx.channels.chat)
		const messagesInDom = await fillHistory(page)
		return {
			name: 'chat',
			description: 'a busy text channel scrolled back until the render window is full',
			measurement: await measure(page, bench.pid),
			notes: { messagesInDom }
		}
	} finally {
		await bench.close()
	}
}

async function scenarioVoiceNotes(ctx: RunContext): Promise<ScenarioResult> {
	const bench = await launchBrowser({ headless: ctx.headless })
	try {
		const { page } = await signIn(bench.browser, ctx.base, 'danil', 'password123')
		await openChannel(page, ctx.channels.audio)
		// every player fetches and decodes on mount today; wait until they settle
		const decodedPlayers = await waitFor(page, COUNT_PLAYERS, (n) => n >= defaultSeed.voiceNotes)
		return {
			name: 'voice-notes',
			description: `a channel of ${defaultSeed.voiceNotes} × ${defaultSeed.voiceSeconds}s voice messages, opened`,
			measurement: await measure(page, bench.pid),
			notes: {
				decodedPlayers,
				messagesInDom: (await page.evaluate(COUNT_MESSAGES)) as number
			}
		}
	} finally {
		await bench.close()
	}
}

/**
 * The call progression, measured in one browser because that is how a member
 * lives it: join, someone turns a camera on, then you wander off to read chat
 * while staying in the call. The three numbers are cumulative by design.
 */
async function scenarioCall(ctx: RunContext): Promise<ScenarioResult[]> {
	const main = await launchBrowser({ headless: ctx.headless })
	const peer = await launchBrowser({ headless: ctx.headless })
	const pid = main.pid
	try {
		const { page } = await signIn(main.browser, ctx.base, 'danil', 'password123')
		const { page: peerPage } = await signIn(peer.browser, ctx.base, 'maks', 'password123')

		await joinVoice(page, ctx.channels.voice)
		await joinVoice(peerPage, ctx.channels.voice)
		await sleep(3000)

		const results: ScenarioResult[] = [
			{
				name: 'call-audio',
				description: 'two members in a voice channel, microphones only',
				measurement: await measure(page, pid, CALL_SETTLE_MS),
				notes: { roomAudioElements: (await page.evaluate(COUNT_ROOM_AUDIO)) as number }
			}
		]

		// the peer turns on a (fake) camera; we are the one watching it
		await clickIcon(peerPage, 'i-lucide:video-off')
		const liveVideo = await waitFor(page, COUNT_LIVE_VIDEO, (n) => n > 0, 30_000)
		await sleep(3000)
		results.push({
			name: 'call-video',
			description: 'the other member turns their camera on; the tile is on screen',
			measurement: await measure(page, pid, CALL_SETTLE_MS),
			notes: { liveVideoElements: liveVideo }
		})

		// Leave the call view for a text channel — still connected, still subscribed,
		// nothing rendering the video. This is the adaptive-stream case.
		//
		// On its own this number cannot attribute anything: the destination channel has
		// its own DOM, and a change that makes *channels* cheaper moves it just as much
		// as one that makes *calls* cheaper. It is half of a pair — `no-call-same-channel`
		// below is the same channel in the same session with the call dropped, and the
		// difference between the two is what holding an unrendered subscription costs.
		await navigateInApp(page, ctx.quiet)
		await sleep(4000)
		results.push({
			name: 'call-video-offscreen',
			description: 'same call, but reading a text channel — the video tile is unmounted',
			measurement: await measure(page, pid, CALL_SETTLE_MS),
			notes: {
				videoElements: (await page.evaluate('document.querySelectorAll("video").length')) as number,
				roomAudioElements: (await page.evaluate(COUNT_ROOM_AUDIO)) as number,
				stillConnected: ((await page.evaluate(COUNT_ROOM_AUDIO)) as number) > 0
			}
		})

		// Back to the call. This is the regression guard for anything that pauses video
		// while it is off screen: a paused subscription that never resumes looks exactly
		// like a working feature in every measurement above, and like a black tile to a
		// member. `liveVideoElements` must be 1 again.
		await returnToVoiceChannel(page, ctx.channels.voice)
		const resumed = await waitFor(page, COUNT_LIVE_VIDEO, (n) => n > 0, 30_000)
		results.push({
			name: 'call-video-return',
			description: 'back in the call view — the tile has to come back to life',
			measurement: await measure(page, pid, CALL_SETTLE_MS),
			notes: { liveVideoElements: resumed }
		})

		// The control for `call-video-offscreen`: same channel, same session, same DOM,
		// with the call hung up from the sidebar panel. Subtracting this from that one
		// isolates the call's own resting cost while nothing renders it — everything the
		// two have in common, the channel included, cancels out. Compare THAT difference
		// across builds; comparing `call-video-offscreen` directly credits the call with
		// whatever the destination channel happened to save.
		await navigateInApp(page, ctx.quiet)
		await clickIcon(page, 'i-lucide:phone-off')
		const remainingAudio = await waitFor(page, COUNT_ROOM_AUDIO, (n) => n === 0, 20_000)
		results.push({
			name: 'no-call-same-channel',
			description: 'the same text channel with the call hung up — the control for the pair',
			measurement: await measure(page, pid, CALL_SETTLE_MS),
			notes: { roomAudioElements: remainingAudio, stillConnected: remainingAudio > 0 }
		})
		return results
	} finally {
		await peer.close()
		await main.close()
	}
}

// --- run --------------------------------------------------------------------

function gitInfo() {
	const run = (args: string[]) =>
		execFileSync('git', args, { encoding: 'utf8', cwd: repoRoot }).trim()
	try {
		return {
			commit: run(['rev-parse', '--short', 'HEAD']),
			dirty: run(['status', '--porcelain']) !== ''
		}
	} catch {
		return { commit: 'unknown', dirty: false }
	}
}

async function detectMode(base: string): Promise<'dev' | 'production' | 'unknown'> {
	try {
		const res = await fetch(`${base}/_nuxt/@vite/client`)
		return res.ok ? 'dev' : 'production'
	} catch {
		return 'unknown'
	}
}

async function run(args: Args) {
	const bootstrap = await launchBrowser({ headless: !args.headed })
	let channels: BenchChannels
	let quiet: string
	try {
		const { context } = await signIn(bootstrap.browser, args.base, 'danil', 'password123')
		channels = await benchChannels(context)
		// #general in a normal database; the voice room is the fallback for a database
		// that never had it (it carries no chat at all, which is close enough)
		const all = await listChannels(context)
		quiet = all.find((c) => c.name === 'general' && c.kind === 'text')?.id ?? channels.voice
	} finally {
		await bootstrap.close()
	}

	const mode = await detectMode(args.base)
	if (mode === 'dev') {
		console.log('! measuring a dev server — fine for A/B, but the absolute numbers are inflated')
	}

	const ctx: RunContext = { base: args.base, headless: !args.headed, channels, quiet }
	const scenarios: ScenarioResult[] = []
	const wanted = args.only

	if (wanted === 'all' || wanted === 'chat') {
		for (const scenario of [scenarioIdle, scenarioChat, scenarioVoiceNotes]) {
			const result = await scenario(ctx)
			console.log(`  ${result.name.padEnd(22)} ${mb(result.measurement.privateTotal)} MB`)
			scenarios.push(result)
		}
	}
	if (wanted === 'all' || wanted === 'call') {
		if (!args.base.includes(':3000')) {
			console.log(`! ${args.base} is not :3000 — LiveKit webhooks land elsewhere, so the call`)
			console.log('  view will have no tiles to measure (see the note at the top of this file)')
		}
		for (const result of await scenarioCall(ctx)) {
			console.log(`  ${result.name.padEnd(22)} ${mb(result.measurement.privateTotal)} MB`)
			scenarios.push(result)
		}
	}

	const report: RunReport = {
		label: args.label,
		startedAt: new Date().toISOString(),
		baseUrl: args.base,
		mode,
		appVersion: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version as string,
		git: gitInfo(),
		headless: !args.headed,
		scenarios
	}

	mkdirSync(resultsDir, { recursive: true })
	const path = join(resultsDir, `${args.label}.json`)
	writeFileSync(path, JSON.stringify(report, null, 2))
	console.log(`\nwrote ${path}`)
	printReport(report)
}

// --- reporting --------------------------------------------------------------

function mb(bytes: number) {
	return (bytes / 1024 / 1024).toFixed(1)
}

const COLUMNS = [
	{ key: 'privateTotal', label: 'total' },
	{ key: 'privateRenderers', label: 'renderer' },
	{ key: 'privateGpu', label: 'gpu' },
	{ key: 'jsHeapUsed', label: 'js heap' }
] as const

function printReport(report: RunReport) {
	console.log(
		`\n${report.label} — ${report.mode} build, app ${report.appVersion}, ${report.git.commit}${report.git.dirty ? '+dirty' : ''}`
	)
	console.log('scenario                   total   renderer      gpu  js heap    nodes  listeners')
	for (const scenario of report.scenarios) {
		const m = scenario.measurement
		console.log(
			[
				scenario.name.padEnd(22),
				`${mb(m.privateTotal)}`.padStart(8),
				`${mb(m.privateRenderers)}`.padStart(10),
				`${mb(m.privateGpu)}`.padStart(8),
				`${mb(m.jsHeapUsed)}`.padStart(8),
				`${m.nodes}`.padStart(9),
				`${m.listeners}`.padStart(10)
			].join('')
		)
	}
	console.log('(MB, private commit; nodes/listeners are the measured page only)')

	const isolated = isolatedCallCost(report)
	if (isolated) {
		console.log('\nheld by the call while nothing renders it (offscreen − control):')
		console.log(COLUMNS.map((c) => `  ${c.label} ${mb(isolated[c.key] ?? 0)} MB`).join(''))
	}
}

// The two scenarios whose difference isolates what an unrendered call costs; see
// the comment on `no-call-same-channel`.
const ISOLATION_PAIR = { withCall: 'call-video-offscreen', control: 'no-call-same-channel' }

/** `call-video-offscreen` minus its control, per column — undefined when a report
 *  predates the pair or only ran half the suite. */
function isolatedCallCost(report: RunReport): Partial<Record<string, number>> | undefined {
	const withCall = report.scenarios.find((s) => s.name === ISOLATION_PAIR.withCall)
	const control = report.scenarios.find((s) => s.name === ISOLATION_PAIR.control)
	if (!withCall || !control) return undefined
	const out: Record<string, number> = {}
	for (const column of COLUMNS) {
		out[column.key] = withCall.measurement[column.key] - control.measurement[column.key]
	}
	return out
}

function loadReport(label: string): RunReport {
	const path = label.endsWith('.json') ? label : join(resultsDir, `${label}.json`)
	if (!existsSync(path)) throw new Error(`no such result: ${path}`)
	return JSON.parse(readFileSync(path, 'utf8')) as RunReport
}

function compare(beforeLabel: string, afterLabel: string) {
	const before = loadReport(beforeLabel)
	const after = loadReport(afterLabel)

	console.log(`\n${before.label} (${before.git.commit}) → ${after.label} (${after.git.commit})`)
	if (before.mode !== after.mode) {
		console.log(`! different build modes (${before.mode} vs ${after.mode}) — not comparable`)
	}

	for (const scenario of after.scenarios) {
		const baseline = before.scenarios.find((s) => s.name === scenario.name)
		if (!baseline) {
			console.log(`\n${scenario.name}: new scenario, no baseline`)
			continue
		}
		console.log(`\n${scenario.name} — ${scenario.description}`)
		for (const column of COLUMNS) {
			const from = baseline.measurement[column.key]
			const to = scenario.measurement[column.key]
			const delta = to - from
			const pct = from === 0 ? 0 : (delta / from) * 100
			const sign = delta > 0 ? '+' : ''
			console.log(
				`  ${column.label.padEnd(10)} ${mb(from).padStart(8)} → ${mb(to).padStart(8)} MB   ${(sign + mb(delta)).padStart(8)} MB  ${(sign + pct.toFixed(1)).padStart(7)}%`
			)
		}
		const notes = Object.entries(scenario.notes)
			.map(([key, value]) => `${key}=${value}`)
			.join(' ')
		const baseNotes = Object.entries(baseline.notes)
			.map(([key, value]) => `${key}=${value}`)
			.join(' ')
		if (notes !== baseNotes) console.log(`  notes      ${baseNotes}  →  ${notes}`)
		else if (notes) console.log(`  notes      ${notes}`)
	}

	// The headline for anything touching video subscription: both sides of the pair
	// carry the same channel, so what is left is the call itself.
	const isolatedBefore = isolatedCallCost(before)
	const isolatedAfter = isolatedCallCost(after)
	if (isolatedBefore && isolatedAfter) {
		console.log('\nheld by the call while nothing renders it (offscreen − control)')
		for (const column of COLUMNS) {
			const from = isolatedBefore[column.key] ?? 0
			const to = isolatedAfter[column.key] ?? 0
			const delta = to - from
			const sign = delta > 0 ? '+' : ''
			console.log(
				`  ${column.label.padEnd(10)} ${mb(from).padStart(8)} → ${mb(to).padStart(8)} MB   ${(sign + mb(delta)).padStart(8)} MB`
			)
		}
	}
	console.log('')
}

// --- entry ------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))

if (args.command === 'seed') {
	const bench = await launchBrowser({ headless: !args.headed })
	try {
		const { context } = await signIn(bench.browser, args.base, 'danil', 'password123')
		await seed(context, { ...defaultSeed, force: args.force })
	} finally {
		await bench.close()
	}
} else if (args.command === 'run') {
	await run(args)
} else if (args.command === 'compare') {
	const [before, after] = args.rest
	if (!before || !after) throw new Error('usage: compare <before-label> <after-label>')
	compare(before, after)
} else if (args.command === 'show') {
	printReport(loadReport(args.rest[0] ?? args.label))
} else {
	console.log(
		readFileSync(new URL(import.meta.url), 'utf8')
			.split('\n')
			.slice(0, 20)
			.join('\n')
	)
	process.exitCode = 1
}
