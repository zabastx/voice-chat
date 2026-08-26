// Bots Long Poll loop (adr/0011). VK's outbound-only transport: the app polls
// lp.vk.ru, so nothing has to reach us — which is the whole reason Telegram
// needed a relay here and VK does not.
//
// Only one inbound transport may run at a time. With both a poll loop and a
// registered Callback server, VK delivers every event twice and each gets
// handled twice, so NUXT_VK_INBOUND picks one.

type LongPollServer = { key: string; server: string; ts: string }
type Poll = { ts?: string; updates?: VkUpdate[]; failed?: number }

// VK recommends 25: some proxies drop the connection at 30
const WAIT_SECONDS = 25
const FETCH_TIMEOUT_MS = (WAIT_SECONDS + 15) * 1000
const RETRY_DELAY_MS = 5000

export default defineNitroPlugin((nitroApp) => {
	const config = useRuntimeConfig()
	if (!vkConfigured() || config.vkInbound !== 'longpoll') return

	let stopped = false
	// the dev server re-runs plugins on reload; without this the pollers stack up
	nitroApp.hooks.hook('close', () => {
		stopped = true
	})

	void (async () => {
		await initDb()
		let session: LongPollServer | null = null

		while (!stopped) {
			try {
				if (!session) {
					session = await vkApi<LongPollServer>('groups.getLongPollServer', {
						group_id: config.vkGroupId
					})
				}
				const base = session.server.startsWith('http')
					? session.server
					: `https://${session.server}`
				const url = `${base}?act=a_check&key=${session.key}&ts=${session.ts}&wait=${WAIT_SECONDS}`
				const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
				const poll = (await res.json()) as Poll

				// 1 = ts outdated (carry on from the ts it returns), 2 = key expired,
				// 3 = both lost. 2 and 3 mean re-fetching the server descriptor.
				if (poll.failed === 1 && poll.ts) {
					session.ts = poll.ts
					continue
				}
				if (poll.failed === 2 || poll.failed === 3) {
					session = null
					continue
				}

				if (poll.ts) session.ts = poll.ts
				for (const update of poll.updates ?? []) {
					if (stopped) break
					// handleVkUpdate swallows its own errors; one bad event must not
					// kill the loop and silence notifications until the next deploy
					await handleVkUpdate(update)
				}
			} catch (err) {
				if (stopped) break
				console.error('vk long poll failed, retrying', err)
				session = null
				await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
			}
		}
	})()
})
