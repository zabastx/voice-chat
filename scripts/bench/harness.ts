// Browser launch + memory sampling for the client-memory benchmark.
// See memory.ts for the CLI; this file is the plumbing.

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Browser, BrowserContext, Page } from 'playwright-core'
import { chromium } from 'playwright-core'

export const here = dirname(fileURLToPath(import.meta.url))
export const repoRoot = join(here, '..', '..')
export const stateDir = join(repoRoot, '.data', 'bench')

export function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

// --- chrome discovery -------------------------------------------------------

// playwright-core ships no browser of its own. Reuse whatever Chromium is already
// on the machine: a Playwright download first (closest to a clean profile), then
// the installed Chrome. BENCH_CHROME overrides both.
export function findChrome(): string {
	if (process.env.BENCH_CHROME) return process.env.BENCH_CHROME

	const local = process.env.LOCALAPPDATA
	if (local) {
		const root = join(local, 'ms-playwright')
		if (existsSync(root)) {
			const builds = readdirSync(root)
				.filter((name) => name.startsWith('chromium-'))
				// chromium-1234 → 1234; newest build wins
				.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
			for (const build of builds) {
				for (const layout of ['chrome-win64', 'chrome-win']) {
					const exe = join(root, build, layout, 'chrome.exe')
					if (existsSync(exe)) return exe
				}
			}
		}
	}

	const installed = [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'/usr/bin/google-chrome',
		'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
	]
	for (const exe of installed) if (existsSync(exe)) return exe

	throw new Error('No Chrome found. Set BENCH_CHROME to a chrome executable.')
}

// --- launch -----------------------------------------------------------------

export interface LaunchOptions {
	headless: boolean
}

export interface BenchBrowser {
	browser: Browser
	/** pid of the Chrome *browser* process — the root of the tree we measure */
	pid: number
	close: () => Promise<void>
}

/**
 * Launch through `launchServer` rather than `launch`: only a BrowserServer hands
 * back the spawned process, and the pid is the whole point — every number in this
 * benchmark is read from the OS by walking that process tree.
 */
export async function launchBrowser({ headless }: LaunchOptions): Promise<BenchBrowser> {
	const server = await chromium.launchServer({
		executablePath: findChrome(),
		headless,
		args: [
			// a call needs a mic and a camera; fake devices keep the run hands-off and
			// make the published video deterministic across runs
			'--use-fake-device-for-media-stream',
			'--use-fake-ui-for-media-stream',
			// so a screen-share scenario never stops on the picker dialog
			'--auto-select-desktop-capture-source=Entire screen',
			'--autoplay-policy=no-user-gesture-required',
			'--mute-audio',
			// headed only: an occluded window gets throttled, which would quietly
			// flatter whichever scenario happened to be behind another window
			'--disable-features=CalculateNativeWinOcclusion'
		]
	})
	const pid = server.process().pid
	if (!pid) throw new Error('browser process has no pid')
	const browser = await chromium.connect(server.wsEndpoint())
	return {
		browser,
		pid,
		close: async () => {
			await browser.close().catch(() => {})
			await server.close()
		}
	}
}

// --- OS-level memory --------------------------------------------------------

export interface ProcSample {
	pid: number
	type: string
	ws: number
	priv: number
}

export interface MemoryTotals {
	/** private commit of the whole browser process tree, bytes */
	privateTotal: number
	/** resident set of the whole tree, bytes */
	workingSetTotal: number
	/** renderers only — DOM, JS heap, decoded images, AudioBuffers */
	privateRenderers: number
	/** the GPU process — where WebRTC video decode buffers live */
	privateGpu: number
	processes: number
}

const psScript = join(here, 'proc-memory.ps1')

function readProcTree(rootPid: number): ProcSample[] {
	if (process.platform === 'win32') {
		const json = execFileSync(
			'powershell.exe',
			['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript, '-Root', String(rootPid)],
			{ encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
		)
		return JSON.parse(json) as ProcSample[]
	}

	// POSIX fallback: rss only (no private commit), tree walked from `ps` output
	const out = execFileSync('ps', ['-eo', 'pid=,ppid=,rss=,args='], { encoding: 'utf8' })
	const rows = out
		.split('\n')
		.map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
		.filter((m): m is RegExpMatchArray => Boolean(m))
		.map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), rss: Number(m[3]) * 1024, args: m[4]! }))

	const picked: ProcSample[] = []
	const queue = [rootPid]
	const seen = new Set<number>()
	while (queue.length) {
		const pid = queue.shift()!
		if (seen.has(pid)) continue
		seen.add(pid)
		const row = rows.find((r) => r.pid === pid)
		if (row) {
			const type = row.args.match(/--type=([a-z-]+)/)?.[1] ?? 'browser'
			picked.push({ pid, type, ws: row.rss, priv: row.rss })
		}
		for (const r of rows) if (r.ppid === pid) queue.push(r.pid)
	}
	return picked
}

export function processTreeMemory(rootPid: number): MemoryTotals {
	const procs = readProcTree(rootPid)
	const sum = (rows: ProcSample[], key: 'ws' | 'priv') =>
		rows.reduce((total, row) => total + row[key], 0)
	return {
		privateTotal: sum(procs, 'priv'),
		workingSetTotal: sum(procs, 'ws'),
		privateRenderers: sum(
			procs.filter((p) => p.type === 'renderer'),
			'priv'
		),
		privateGpu: sum(
			procs.filter((p) => p.type === 'gpu-process'),
			'priv'
		),
		processes: procs.length
	}
}

// --- in-page metrics --------------------------------------------------------

export interface PageMetrics {
	jsHeapUsed: number
	nodes: number
	listeners: number
	documents: number
	frames: number
	layoutObjects: number
}

const cdpSessions = new WeakMap<Page, Awaited<ReturnType<BrowserContext['newCDPSession']>>>()

async function cdpFor(page: Page) {
	const existing = cdpSessions.get(page)
	if (existing) return existing
	const session = await page.context().newCDPSession(page)
	await session.send('Performance.enable')
	cdpSessions.set(page, session)
	return session
}

/** Force a full GC so the numbers describe retained memory, not garbage yet to be swept. */
export async function collectGarbage(page: Page) {
	const cdp = await cdpFor(page)
	await cdp.send('HeapProfiler.collectGarbage')
	await sleep(600)
	await cdp.send('HeapProfiler.collectGarbage')
	await sleep(400)
}

export async function pageMetrics(page: Page): Promise<PageMetrics> {
	const cdp = await cdpFor(page)
	const { metrics } = (await cdp.send('Performance.getMetrics')) as {
		metrics: { name: string; value: number }[]
	}
	const read = (name: string) => metrics.find((m) => m.name === name)?.value ?? 0
	return {
		jsHeapUsed: read('JSHeapUsedSize'),
		nodes: read('Nodes'),
		listeners: read('JSEventListeners'),
		documents: read('Documents'),
		frames: read('Frames'),
		layoutObjects: read('LayoutObjects')
	}
}

function median(values: number[]): number {
	const sorted = [...values].sort((a, b) => a - b)
	const mid = Math.floor(sorted.length / 2)
	return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2)
}

export interface Measurement extends MemoryTotals, PageMetrics {}

/**
 * One measurement of the measured browser: GC, let it settle, then take three
 * OS reads and keep the median. Chrome releases memory lazily, so the settle is
 * load-bearing — sampling straight after a navigation reads the peak, not the
 * resting cost, and the peak is far noisier than what we want to compare.
 */
export async function measure(page: Page, rootPid: number, settleMs = 4000): Promise<Measurement> {
	await sleep(settleMs)
	await collectGarbage(page)
	const samples = []
	for (let i = 0; i < 3; i++) {
		samples.push(processTreeMemory(rootPid))
		await sleep(700)
	}
	const pick = (key: keyof MemoryTotals) => median(samples.map((s) => s[key]))
	return {
		privateTotal: pick('privateTotal'),
		workingSetTotal: pick('workingSetTotal'),
		privateRenderers: pick('privateRenderers'),
		privateGpu: pick('privateGpu'),
		processes: pick('processes'),
		...(await pageMetrics(page))
	}
}

// --- app helpers ------------------------------------------------------------

export interface AppSession {
	context: BrowserContext
	page: Page
}

/**
 * A logged-in context. The session cookie is cached in .data/bench so repeat runs
 * don't spend the login rate limit (10 per 15 min, requireRateLimit in login.post).
 */
export async function signIn(
	browser: Browser,
	baseUrl: string,
	username: string,
	password: string
): Promise<AppSession> {
	mkdirSync(stateDir, { recursive: true })
	const statePath = join(stateDir, `${username}.json`)
	const context = await browser.newContext({
		baseURL: baseUrl,
		storageState: existsSync(statePath) ? statePath : undefined,
		viewport: { width: 1440, height: 900 }
	})

	// any session-gated GET works as the probe; /api/channels is the cheapest
	const probe = await context.request.get('/api/channels', { failOnStatusCode: false })
	if (!probe.ok()) {
		const res = await context.request.post('/api/auth/login', {
			data: { username, password, remember: true },
			failOnStatusCode: false
		})
		if (!res.ok()) {
			throw new Error(`login failed for ${username}: ${res.status()} ${await res.text()}`)
		}
	}
	await context.storageState({ path: statePath })

	const page = await context.newPage()
	return { context, page }
}

export interface ChannelSummary {
	id: string
	name: string
	kind: 'text' | 'voice'
}

export async function listChannels(context: BrowserContext): Promise<ChannelSummary[]> {
	const res = await context.request.get('/api/channels')
	if (!res.ok()) throw new Error(`GET /api/channels → ${res.status()}`)
	return (await res.json()) as ChannelSummary[]
}

/** Open a channel and wait for its first paint to finish. */
export async function openChannel(page: Page, channelId: string) {
	await page.goto(`/channels/${channelId}`, { waitUntil: 'domcontentloaded' })
	await page.waitForLoadState('networkidle').catch(() => {})
	await sleep(1000)
}
