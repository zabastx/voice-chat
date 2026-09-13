import { toWebRequest } from 'h3'

// The public Desktop Update feed (adr/0014). It is reachable before Sign-in on
// purpose: the Desktop Client checks it at startup, before the remote Web
// Release — and therefore any session — has loaded. Tauri fills the query from
// its own build: ?target=windows&arch=x86_64&version=<current>.
//
// Everything interesting lives in the feed itself; see server/utils/desktop-feed.ts.

export default defineEventHandler((event) => useDesktopUpdateFeed().respond(toWebRequest(event)))
