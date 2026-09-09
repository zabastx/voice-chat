# 0013 — Remote UI behind a versioned Native Bridge

Date: 2026-09-09
Status: accepted — implementation pending

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
but cannot reach the updater or another OS capability. The existing Web Notification API remains
the first notification path; if its tray behavior fails verification, one additional typed bridge
operation may show a bounded title/body through Tauri. Any further reverse operation requires a
concrete capability and its own validation boundary.

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
