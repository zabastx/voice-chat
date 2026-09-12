# 0013 — Remote UI behind a versioned Native Bridge

Date: 2026-09-09
Status: accepted — bridge implemented 2026-09-09, installer implemented 2026-09-10, Portable update offer implemented 2026-09-11, installed updater implemented 2026-09-11, notifications implemented 2026-09-12

The Windows Desktop Client will continue to load the Web Release from the one production HTTPS
origin instead of bundling a second copy of the Vue UI. This keeps browser and desktop on the same
deployed interface and lets routine Web Releases ship without rebuilding the Desktop Client. Release
builds will embed that origin; only debug builds may override it with a loopback address.

The remote page will not receive general Tauri command access. Native features will cross a small,
versioned Native Bridge, initially limited to bridge/version discovery and desktop lifecycle state.
The Web Release must feature-detect every capability and continue to work when the bridge is absent
or older. Expanding this allowlist is a Desktop Release decision rather than an incidental web
change.

The first bridge sends an immutable version descriptor and allowlisted native events to the Web
Release. Updater, window, and tray interactions remain owned by the native shell. General `invoke`
access stays unavailable to the remote origin. Its sole reverse operation is a validated
`setVoiceActive(boolean)` lifecycle signal: the page can postpone an update while a call is active,
but cannot reach the updater or another OS capability. Any further reverse operation requires a
concrete capability and its own validation boundary.

The Web Notification API was the intended first notification path and cannot be one: WebView2
resolves `Notification.requestPermission()` to `denied` without ever prompting, and a constructed
notification fires `error` (measured 2026-09-12, GOTCHAS 31). So the reserved fallback is taken.
`notifications` is a second capability whose whole vocabulary is `showNotification({title, body})`:
two short lines of plain text, bounded in TypeScript before they are sent and again in Rust on
arrival, with no tag, icon, button, action or URL. A remote origin therefore cannot aim a click
anywhere from the member's desktop, and the shell rate-limits what it relays so a page stuck in a
loop cannot bury the desktop. Notification text never enters the desktop log.

Two member-visible differences follow from that narrowness, and are accepted rather than worked
around. Clicking a Windows toast does nothing — carrying a destination would be exactly the
authority this refuses — so the member opens the window from the tray; in a browser the same
notification still opens its channel, because there the URL is the page's own to navigate. And with
no tag to coalesce on, a second message about the same conversation stacks a second toast where a
browser would have replaced the first. Wiring toast activation to "restore the window", which needs
no destination from the page, is a reasonable later Desktop Release; it is not in this one.

A third capability, `window-focus`, exists because that notification could not otherwise be
decided: a Desktop Client hidden in the tray still reports `document.hasFocus() === true` to its own
page (GOTCHAS 30), so the page cannot tell whether the member is looking. It is a native event
rather than a reverse operation — the shell pushes whether the window is in the foreground and the
page reads it — and it grants the page no authority at all. Letting the shell decide instead was
rejected: only the page knows whether the message belongs to the conversation on screen, and only
the shell knows whether that screen is visible, so each answers the half it can see.

The rejected alternative was bundling the full UI into every Desktop Release. It gives the native
shell a fixed UI version and a smaller remote-code boundary, but it couples every UI fix to a new
installer and creates a second release path for the same interface. For this single-server private
Space, a fixed trusted origin plus a minimal bridge gives the preferred update model without giving
the server arbitrary native authority.

The first published target is Windows 10/11 x64 as `0.1.0-alpha.1`, under the product name
`Voice Chat` and identifier `ru.zabastx.voicechat`. It includes the installer, updater, tray
behavior, and single-instance behavior already explored by the prototype. Global push-to-talk
remains a possible future feature and is outside this release plan.

If the production origin cannot load, a bundled local screen offers retry and exit while the client
remains available in the tray and retries periodically. There is no offline copy of the Space. Alpha
diagnostics stay in bounded local logs with an action to open their folder; the client sends no
telemetry or crash report automatically.
