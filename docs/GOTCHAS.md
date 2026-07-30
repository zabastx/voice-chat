# Gotchas — traps that already cost time

Read before touching the dev workflow, the WebSocket/voice path, or the storage layer.

## Runtime & tooling

### 1. Zod 4: namespace import only

`import { z } from 'zod'` → SSR 500 (`undefined is not an object (evaluating '__vite_ssr_import_0__.z.string')`) under Vite's SSR transform. Always `import * as z from 'zod'` — server handlers, pages, shared schemas.

### 2. Dev = Node runtime, prod = Bun runtime

Running dev under Bun (`bun --bun nuxt dev`) routes WS upgrades through Nuxt's dev proxy, which silently drops them — `/_ws` hangs forever. `bun run dev` stays plain `nuxt dev --host` (Node). Re-verified still broken 2026-07-05 (Bun 1.3.14 + Nuxt 4.4.8). Since [ADR 0004](adr/0004-postgres-replaces-sqlite.md) the DB doesn't care: postgres.js works on both runtimes, no driver fork.

### 2b. postgres:18 image moved its volume mount point

`postgres:18` declares `VOLUME /var/lib/postgresql` (parent dir, for in-place `pg_upgrade`), not `.../data` like ≤17. A volume mounted at the old `.../data` path leaves the cluster on the container's writable layer — data vanishes on recreate. Mount the named volume at `/var/lib/postgresql` (done in [compose.dev.yaml](../compose.dev.yaml) and [compose.yaml](../compose.yaml)).

### 3. `useToast is not defined` — stale .nuxt cache

SSR 500 after heavy HMR churn; not a real code error. Stop the server, delete `.nuxt`, `bun run postinstall`, restart.

### 4. vue-tsc "Excessive stack depth" on `$fetch('/api/...')`

TS2321 — Nuxt's typed-route inference chokes without an explicit return type. Give `$fetch` a generic: `$fetch<ChannelDto[]>('/api/channels')`, or use `useRequestFetch<T>()`.

### 4b. `typescript@7` (tsgo) breaks `nuxt typecheck`

`ERR_PACKAGE_PATH_NOT_EXPORTED: … './lib/tsc'` — TS 7 is the Go-based compiler and no longer ships `lib/tsc`, which `vue-tsc` 3.x patches into. Keep `typescript` pinned to `^6.0.3` until a vue-tsc release supports TS 7. On blanket dependency upgrades, `(v7.x available)` in bun's install output is the tell.

### 5. `@click` handlers that return a value

`overlay.open()` / `modal.open()` return a value; Vue's click handler type wants `void` → TS2322. Wrap: `@click="() => modal.open()"`.

### 6. Reka `USelect` items cannot use `''` as a value

Empty string is reserved for "cleared" — console error + broken select. Use a non-empty sentinel: device pickers use `'default'` (Chrome's own `'default'` pseudo-device filtered out of the list first). See [SettingsVoice.vue](../app/components/settings/SettingsVoice.vue).

### 7. `UDashboardGroup` storage prop value

`storage="local"`, not `"localStorage"` (valid: `'cookie' | 'local'`).

### 8. `UDashboardSidebarToggle` / `Collapse` act on ALL sidebars

The built-in buttons (and `UDashboardNavbar`'s default hamburger) fire group-wide hooks every sidebar listens to — with two sidebars, one button opens/collapses both; the `side` prop only styles. Don't use them: drive each sidebar's `v-model:open` individually, hide desktop panels via `:ui="{ root: '... lg:hidden' }"`, set `:toggle="false"` on `UDashboardNavbar`, override the sidebar `#toggle` slot for the slideover close. A right-side slideover also needs `:menu="{ side: 'right' }"`. See [usePanels.ts](../app/composables/usePanels.ts), [SidebarToggle.vue](../app/components/SidebarToggle.vue), [MembersToggle.vue](../app/components/MembersToggle.vue).

### 9. `UDashboardPanel`: default slot content suppresses `#header`

Header/body/footer render as _fallback_ of the default slot — any direct child outside a named template replaces all three (invisible navbar). When using `#header`, put page content in `<template #body>`; if the page manages its own scroll, neutralize body padding via `:ui="{ body: 'min-h-0 gap-0 p-0 sm:gap-0 sm:p-0' }"`. See [channels/[id].vue](../app/pages/channels/[id].vue).

### 10. fetch `BodyInit` rejects `Uint8Array`

TS2322 in `putObject` (`SharedArrayBuffer` leaks into the union). Copy into a fresh plain-`ArrayBuffer`-backed view: `const bytes = new Uint8Array(body.byteLength); bytes.set(body);` — see [storage.ts](../server/utils/storage.ts).

### 10b. Presigned-redirect attachments break JS readers (CORS)

`GET /api/attachments/:id` 302-redirects to a presigned S3 URL. Media elements load cross-origin responses opaquely (fine), but `VoiceMessagePlayer` reads raw bytes in JS (`fetch → decodeAudioData` for the waveform) → prod console `CORS Missing Allow Origin`; the bucket sends no CORS headers. Fix: the endpoint's `?proxy` query param streams bytes through the app (same-origin) — the voice player uses it, media elements keep the cheap redirect. See [attachments/[id].get.ts](../server/api/attachments/[id].get.ts), `getObject` in [storage.ts](../server/utils/storage.ts).

### 10c. `sharp` (image previews) — native module: dual-runtime + Docker traps

In-chat previews via `sharp` in [image-preview.ts](../server/utils/image-preview.ts). How it's handled:

- Dynamic `await import('sharp')` in the server util — never enters the client/SSR bundle.
- `trustedDependencies` includes `sharp`; 0.33+ ships prebuilds as `optionalDependencies` (`@img/sharp-*`), so the Dockerfile's `bun install --ignore-scripts` is fine.
- **Lockfile trap:** dev is Windows, prod image is linux/glibc. `bun.lock` must contain `@img/sharp-linux-x64` **and** `@img/sharp-libvips-linux-x64` or the frozen Docker install skips the binary and sharp throws at runtime. Bun locks the full platform graph, but re-verify after any lockfile regeneration.
- **Docker trap:** the sharp addon **dlopens** `libvips-cpp.so` from the sibling libvips package; Nitro's static trace can't follow dlopen, so a runtime image shipping only `.output` throws `Could not load the "sharp" module … cannot open shared object file` on first upload. Fix in the [Dockerfile](../Dockerfile): a `deps` stage runs `bun install --production`, the runtime stage copies that `node_modules`, and `ENV LD_LIBRARY_PATH=/app/node_modules/@img/sharp-libvips-linux-x64/lib` points the linker at the `.so`.
- Verified under the Bun runtime locally (direct script run resizes to WebP); the full Docker path is only proven by building the image and uploading in the container.
- Non-fatal: `generateImagePreview` never throws — returns null, upload succeeds, `?preview` falls back to the original.

## SSR / data

### 11. Session cookie not forwarded during SSR

Bare `$fetch` on the server drops the incoming request's session cookie → empty channel list / anonymous first paint; works after client nav. Use `useRequestFetch()` for any authed fetch that can run during SSR. See [useChannelsStore.ts](../app/composables/useChannelsStore.ts).

### 12. Playwright fills the login form before hydration

Form model stays empty → "expected string, received undefined" on submit. Test-side fix: wait for hydration, then fill (re-fill if the first attempt landed early). Not an app bug.

## Localization

### 13. Cyrillic in `statusMessage` breaks Node

HTTP reason phrases must be ASCII. Russian text goes in `message` (clients read `err.data.message`); keep `statusMessage` ASCII or omit. Exception: `server/api/livekit/webhook.post.ts` is machine-facing, stays English.

## LiveKit / voice (local dev)

### 14. Webhooks can't resolve the app

LiveKit log: `lookup host.docker.internal … no such host`; voice roster never populates. Run the container with `--add-host=host.docker.internal:host-gateway`.

### 15. Vite blocks the webhook host (403)

`vite.server.allowedHosts: ['host.docker.internal']` in `nuxt.config.ts` (already set), and run `nuxt dev --host`.

### 16. Browsers on the host can't reach RTC media

LiveKit advertises its container-internal IP (172.17.x.x) → signaling connects, then drops. Pass `--node-ip 127.0.0.1` as a **CLI flag** to `livekit-server`. Traps: `node_ip` as a config-file key crashes the server (`field node_ip not found`); a hostname value (`host.docker.internal`) is **silently ignored** — startup log shows the container IP as `nodeIP` and ICE fails with no obvious cause. Always a literal IP; `127.0.0.1` works on Docker Desktop Win/Mac and native Linux.

### 17. Screen share can't be tested headless

Headless Chromium has no screen to capture. Publish/subscribe plumbing is identical to the (verified) audio path. Test headed or after deploy.

### 18. Firefox ICE fails, Chrome works (mDNS + loopback TURN)

Firefox connects to signaling then drops with `ICE failed, your TURN server appears to be broken`; Chrome on the same machine is fine. Two causes: (1) Firefox obfuscates local ICE candidates as mDNS `*.local` hostnames, which containerized LiveKit can't resolve (LiveKit logs show `[filtered] udp host :port`), so direct ICE can't pair; (2) with `--node-ip 127.0.0.1` the built-in TURN relay is advertised at loopback, and Firefox refuses TURN allocations to loopback. Chrome doesn't obfuscate for localhost origins, never needs TURN.
**Fix:** set `LIVEKIT_NODE_IP` to your machine's LAN IP in `.env` (`ipconfig` / `ip addr`) — [compose.dev.yaml](../compose.dev.yaml) passes it as `--node-ip`, so TURN gets a non-loopback address. Chrome works either way.
**Traps:** LiveKit v1.x has no `turn_servers` config key (`field turn_servers not found`) — use the built-in `turn:` section in [livekit.dev.yaml](../livekit.dev.yaml); `--node-ip` must be an IP, not a hostname (see #16).
**Manual fallback:** Firefox `about:config` → `media.peerconnection.ice.obfuscate_host_addresses = false`.

## Watch Together (YouTube embed)

### 18b. An iframe cannot be moved, and Vue must not own the one YouTube replaces

Two separate traps in [WatchStage.vue](../app/components/WatchStage.vue), both presenting as "the video restarts by itself" or a crash on unmount:

- **Reparenting restarts playback.** Moving an `<iframe>` in the DOM discards its browsing context, so the player reloads from zero. This rules out the obvious implementations of both focus mode and a mini player: `ChannelVoice.vue` renders tiles in a `v-if` focus branch and a `v-else-if` grid branch (fine for `<video>`, fatal here), and a mini player cannot be built by moving the iframe into a corner widget. The player therefore lives in **`WatchPlayerHost` in the layout, outside `<NuxtPage>`**, so route changes never unmount it; only its CSS position/size changes, tracking a placeholder that `ChannelVoice` registers. Tile focus stays disabled while a watch is on so that placeholder's box is stable. Don't "improve" this by mounting the stage inside the page or by teleporting it.
  - Corollary: `<KeepAlive>` is **not** a fix for the same problem. It detaches the subtree from the document, which also destroys the browsing context.
  - A `ResizeObserver` on the placeholder is not enough to track it: collapsing the sidebar _moves_ the stage without resizing it, and the observer never fires. `useWatchStage` reads the rect on an rAF loop that only runs while docked.
- **`YT.Player` replaces the element you hand it.** If that element is one Vue rendered, unmount calls `removeChild` on a node whose `parentNode` the API already cleared. The mount node is created with `document.createElement` inside a Vue-owned host, so Vue never owns what the API destroys.

### 18d. You cannot grant autoplay by setting `allow` after the frame has loaded

A cross-origin iframe does **not** inherit the parent's user activation, so autoplay needs `allow="autoplay"` on the frame — but permissions policy is evaluated **when the frame navigates**. Setting the attribute at `onReady` is far too late to grant anything, and worse, it _replaces_ the `allow` list the IFrame API already put on its own frame (which includes `autoplay`), so the "fix" is a silent downgrade. Let the API's own attribute stand; treat the «Нажмите, чтобы смотреть» fallback in `WatchStage.vue` as load-bearing rather than exceptional. Unrelated but adjacent: without `playsinline=1` iOS Safari forces the video fullscreen.

### 18e. YouTube's "not live" is indistinguishable from "don't know yet"

`getVideoData()` is usually empty at `onReady`, so `isLive` is `undefined` long before it is `false`. Reporting that as a fact makes every joining client flip a live session back to VOD, which unfreezes an anchor that has been standing still and scatters the whole room. Clients report **positives only** and the server latches `live` on (`watch-state.ts`); within one video id it never legitimately becomes false. Same reasoning for the title — absence is not emptiness.

### 18g. A detached watcher must not watch a composable's `computed`

`useWatch` keeps one anchoring watcher in a detached `effectScope`. If that watcher's source is a `computed()` created inside `useWatch()`, the computed belongs to the scope of whichever component called the composable **first** — when that component unmounts, its effect stops and the watcher goes deaf permanently. Watch the global `useState` refs and derive inside the callback instead. `usePreferences` only gets away with the same pattern because it watches a `useState` ref directly.

Symptom is narrow enough to miss: leaving a voice channel and rejoining **without a page reload** leaves the anchor `null` and no player mounted, while a fresh page load works perfectly.

### 18h. `new YT.Player()` returns an object with no API methods

The constructor returns synchronously, but `getPlayerState`, `getCurrentTime` etc. do not exist until `onReady` fires. Touching the player before then throws — and because watch broadcasts can land during init, the throw repeats inside a Vue watcher (`Unhandled error during execution of component update`) and the stage sits mounted with **no iframe at all**. Guard every player access with a `ready` flag set in `onReady`, not merely a null check on the instance.

### 18f. With native player controls, a user's seek and a viewer's drift look identical

Both present as "my position disagrees with the anchor", so no threshold can separate them — and treating drift as intent means one viewer's ad break or buffer stall **rewinds everyone else**. `correctDrift` compares how far the playhead moved against how much wall time passed: ordinary playback advances by roughly the elapsed time, a seek is a jump that doesn't. Only the jump is broadcast; a plain disagreement is corrected locally and silently. Don't reintroduce a position push from the state-change handler.

Two refinements that were both got wrong first and caught only by driving it in a real browser:

- **The test must be asymmetric.** `|advance - elapsed| > tol` looks right and reintroduces the bug: a buffering stall or an ad freezes the playhead across a 3s tick, which that form reads as a seek and rebroadcasts. Only `advance > elapsed + tol` (jumped ahead) or `advance < -tol` (jumped back) is a seek; `0 ≤ advance ≪ elapsed` is a stall.
- **`onStateChange` must not refresh the position baseline.** A seek fires a state change, so calling `notePosition()` there erases the jump before the drift tick can see it — the seek then looks like ordinary playback and gets "corrected" back to the anchor instead of propagating to everyone.

### 18c. `getVideoData().isLive` is undocumented

The only client-side signal for "this is a live broadcast" (which disables timeline sync — see [ADR 0008](adr/0008-watch-together-synced-embeds.md)). It is absent from `@types/youtube`, hence the hand-written [app/types/youtube.d.ts](../app/types/youtube.d.ts). If YouTube drops it, live sessions silently degrade to being treated as VODs — viewers fight the DVR window instead of failing loudly.

## Client / PWA

### 19. Leftover service worker from a previous app hijacks the origin

The origin previously hosted another app (Stoat); its SW outlives it and keeps serving the stale cached shell — hard reload only bypasses the top-level navigation. This app ships **no** SW, so any registration is stale: [unregister-sw.client.ts](../app/plugins/unregister-sw.client.ts) unregisters every worker, clears Cache Storage, and reloads once (sessionStorage-guarded) when a worker controls the page. Manual: DevTools → Application → Service Workers → Unregister + Clear site data.

## Telegram notifications

### 20. Prod host filters Telegram — notifications go through a separate relay

The VPS (`…cloud.ru`) blocks Telegram **both ways**: `api.telegram.org` resolves IPv6-only (no working v6 egress; Bun's fetch won't fall back to v4) and inbound webhook delivery is dropped — even though the site is publicly reachable. The app never talks to Telegram directly: the standalone stateless `telegram-relay/` service (hosted where Telegram is reachable) is the only thing touching `api.telegram.org`; the app reaches it over plain HTTP (`NUXT_TELEGRAM_RELAY_URL` + `NUXT_TELEGRAM_RELAY_SECRET`) and updates come back via `POST /api/telegram/ingest`. See [ADR 0006 "Update: relay transport"](adr/0006-telegram-notifications.md) and [telegram-relay/README.md](../telegram-relay/README.md). Local dev: point at a relay instance, or leave unset to no-op the feature.

## Deploy notes worth remembering

- Two DNS records: `DOMAIN` and `livekit.DOMAIN`, both → VPS IP. Caddy proxies LiveKit _signaling_; RTC media flows directly over UDP (LiveKit on host networking in prod).
- Firewall: 80/443 tcp, 7881 tcp (RTC fallback), 3478 udp (built-in TURN — Firefox + symmetric-NAT clients), 50000–60000 udp (RTC media). Do **not** expose 3000 or 7880. TURN relay range 57000–57100 stays internal (SFU↔TURN share the host).
- Local prod smoke test: `bun --bun nuxt build`, then run `.output/server/index.mjs` under Bun with `NUXT_DATABASE_URL` / `NUXT_MIGRATIONS_DIR` set — the exact Bun + postgres.js + migration path the container uses.
