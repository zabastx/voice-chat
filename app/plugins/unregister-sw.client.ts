// This app ships no service worker of its own, so any SW registered on this
// origin can only be a leftover from a previously self-hosted app (e.g. Stoat)
// — and it will hijack navigations by serving that app's cached shell. Shed it:
// unregister every worker, drop its caches, and reload once (guarded) if one is
// currently controlling the page, so the user lands on the real app.
export default defineNuxtPlugin(() => {
	if (!('serviceWorker' in navigator)) return

	void navigator.serviceWorker
		.getRegistrations()
		.then(async (registrations) => {
			if (registrations.length === 0) return
			await Promise.all(registrations.map((r) => r.unregister()))
			if ('caches' in window) {
				const keys = await caches.keys()
				await Promise.all(keys.map((k) => caches.delete(k)))
			}
			// a still-controlling worker keeps serving the stale shell until reload
			if (navigator.serviceWorker.controller && !sessionStorage.getItem('sw-cleared')) {
				sessionStorage.setItem('sw-cleared', '1')
				location.reload()
			}
		})
		.catch(() => {
			// best-effort cleanup — never block app start on it
		})
})
