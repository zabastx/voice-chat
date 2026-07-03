# Gotchas — problems hit during the build and how they were solved

Read this before touching the dev workflow, the WebSocket/voice path, or the storage layer.
Each entry is a real trap that already cost time.

## Runtime & tooling

### 1. Zod 4 must be imported as a namespace

**Symptom:** SSR 500 `undefined is not an object (evaluating '__vite_ssr_import_0__.z.string')`.
**Cause:** `import { z } from 'zod'` breaks under Vite's SSR transform for Zod 4.
**Fix:** always `import * as z from 'zod'`. Applies to server handlers, pages, and shared schemas.

### 2. Dev = Node runtime, prod = Bun runtime

**Symptom:** WebSocket `/_ws` upgrade hangs forever; no error, connection never opens.
**Cause:** running the dev server under the Bun runtime (`bun --bun nuxt dev`) routes WS upgrades
through Nuxt's dev proxy, which drops them.
**Fix:** `bun run dev` is plain `nuxt dev --host` (Node). Because Node can't use `bun:sqlite`, the
DB layer picks a driver at runtime: [server/utils/db.ts](../server/utils/db.ts) uses
`'Bun' in globalThis` to choose `bun:sqlite` (prod) vs `better-sqlite3` (dev). Both go through the
same Drizzle sync API. Keep both drivers installed.

### 3. `useToast is not defined` — stale .nuxt cache

**Symptom:** SSR 500 `useToast is not defined` after heavy HMR churn (lots of edits in one session).
**Cause:** stale Nuxt auto-import cache, not a real code error.
**Fix:** stop the server, delete `.nuxt`, `bun run postinstall` (regenerates types/imports), restart.

### 4. vue-tsc "Excessive stack depth" on `$fetch('/api/...')`

**Symptom:** typecheck error TS2321 "Excessive stack depth comparing types" pointing at a route string.
**Cause:** Nuxt's typed-route inference chokes on some `$fetch` calls without an explicit return type.
**Fix:** give `$fetch` an explicit generic — `$fetch<ChannelDto[]>('/api/channels')` — or use
`useRequestFetch<T>()`.

### 5. `@click` handlers that return a value

**Symptom:** TS2322 "Type '(e: MouseEvent) => OpenedOverlay<...>' is not assignable to ... => void".
**Cause:** `overlay.open()` / `modal.open()` return a value; Vue's click handler type wants `void`.
**Fix:** wrap in a void arrow: `@click="() => modal.open()"` or a named `function openX() { modal.open() }`.

### 6. `UDashboardGroup` storage prop value

`storage="local"`, not `"localStorage"`. The valid values are `'cookie' | 'local'`.

### 7. fetch `BodyInit` rejects `Uint8Array`

**Symptom:** TS2322 in `putObject` — `Uint8Array<ArrayBufferLike>` not assignable to `BodyInit`,
and `SharedArrayBuffer` leaking into the union.
**Fix:** copy into a fresh, plain-`ArrayBuffer`-backed view before passing to `fetch`:
`const bytes = new Uint8Array(body.byteLength); bytes.set(body);` — see
[server/utils/storage.ts](../server/utils/storage.ts).

## SSR / data

### 8. Session cookie not forwarded during SSR

**Symptom:** channel list empty (or channel names render as `#`) on first server-rendered paint;
works after client navigation.
**Cause:** bare `$fetch` on the server doesn't carry the incoming request's session cookie.
**Fix:** use `useRequestFetch()` for any authed fetch that can run during SSR. See
[app/composables/useChannelsStore.ts](../app/composables/useChannelsStore.ts).

### 9. Playwright fills the login form before hydration

**Symptom:** submit shows "Invalid input: expected string, received undefined" — form state empty.
**Cause:** filling inputs before Vue hydrates doesn't populate the reactive form model.
**Fix (test-side):** wait for hydration, then fill (re-fill if the first attempt landed too early).
Not an app bug.

## Localization

### 10. Cyrillic in `statusMessage` breaks Node

**Symptom:** requests with Russian `createError({ statusMessage: 'Только...' })` fail oddly.
**Cause:** HTTP reason phrases must be ASCII; Node rejects non-ASCII.
**Fix:** put Russian text in `message`, keep `statusMessage` ASCII or omit it. Clients read
`err.data.message`. The one exception is `server/api/livekit/webhook.post.ts` — machine-facing, so
its messages stay English.

## LiveKit / voice (local dev)

### 11. Webhooks can't resolve the app

**Symptom:** LiveKit log: `dial tcp: lookup host.docker.internal on 8.8.8.8:53: no such host`;
sidebar voice roster never populates.
**Fix:** run the container with `--add-host=host.docker.internal:host-gateway`.

### 12. Vite blocks the webhook host

**Symptom:** container reaches the app but gets HTTP 403.
**Cause:** Vite dev server host allowlist.
**Fix:** `vite.server.allowedHosts: ['host.docker.internal']` in `nuxt.config.ts` (already set),
and run `nuxt dev --host` so it binds all interfaces.

### 13. Browsers on the host can't reach RTC media

**Symptom:** signaling connects, then immediately disconnects; `WebSocket ... 7880 ... refused`
and RTC never establishes. LiveKit advertises its container-internal IP (172.17.x.x).
**Fix:** pass `--node-ip 127.0.0.1` as a **CLI flag** to `livekit-server`.
**Trap within the trap:** `node_ip: 127.0.0.1` as a config-file _key_ does NOT work — LiveKit
exits with `could not parse config: field node_ip not found`. It must be the CLI flag.
**Second trap:** the value must be an **IP, not a hostname**. `--node-ip host.docker.internal`
silently falls back to the container IP (startup log shows `nodeIP: 172.x.x.x` instead of your
value), so the browser still can't reach RTC and ICE fails with no obvious cause. Always use
`127.0.0.1` (works on Docker Desktop Win/Mac and native Linux — the host kernel forwards
loopback UDP to the published RTC ports).

### 14. Screen share can't be tested headless

Headless Chromium has no screen to capture, so the video path is unverified. The publish/subscribe
plumbing is identical to the audio path (which IS verified). Test in a headed browser or after deploy.

### 15. Firefox ICE fails, Chrome works (mDNS + loopback TURN)

**Symptom:** in Firefox, voice connects to signaling then drops with
`WebRTC: ICE failed, your TURN server appears to be broken`. Chrome on the same
machine works perfectly.
**Cause (two-part):** (1) Firefox obfuscates its own local ICE candidates as
mDNS `*.local` hostnames, which the containerized LiveKit can't resolve — in the
LiveKit logs the remote candidates show up as `[filtered] udp host :port` (no
IP). So direct ICE can't pair. (2) The built-in TURN relay (which would give
Firefox a non-mDNS relay candidate) is advertised at the node IP, and with the
default `--node-ip 127.0.0.1` Firefox **refuses TURN allocations to loopback**
(STUN works, but the authenticated Allocate fails). Chrome doesn't obfuscate for
localhost origins, so it never needs TURN and is unaffected.
**Fix:** set `LIVEKIT_NODE_IP` to your machine's LAN IP in `.env` (e.g.
`192.168.1.x`). [compose.dev.yaml](../compose.dev.yaml) passes it to LiveKit as
`--node-ip`, so the built-in TURN is advertised at a non-loopback address and
Firefox allocates successfully. The browser must reach that IP on the published
RTC/TURN ports (it can — UDP forwarding to the host LAN IP works on Docker
Desktop). Find your IP with `ipconfig` (Windows) / `ip addr` (Linux). Chrome
works with or without it; Firefox needs it.
**Trap:** LiveKit v1.x has NO `turn_servers` config key for external relays
(`could not parse config: field turn_servers not found`). Use the built-in
`turn:` section in [livekit.dev.yaml](../livekit.dev.yaml). And `--node-ip` must
be an IP — a hostname (`host.docker.internal`) is silently ignored and falls
back to the container IP.
**Manual fallback:** if `LIVEKIT_NODE_IP` is unset, Firefox also works by
setting `media.peerconnection.ice.obfuscate_host_addresses` = `false` in
`about:config` (reveals real local IPs so direct ICE pairs without TURN).

## Deploy notes worth remembering

- Two DNS records: `DOMAIN` and `livekit.DOMAIN`, both → VPS IP. Caddy proxies LiveKit _signaling_;
  RTC media flows directly over the UDP range (LiveKit runs on host networking in prod).
- Firewall: 80/443 tcp, 7881 tcp (RTC fallback), 3478 udp (built-in TURN — Firefox
  + symmetric-NAT clients), 50000–60000 udp (RTC media). Do **not** expose 3000 or
  7880 — loopback/proxied only. The TURN relay range (57000–57100) stays internal
  (SFU↔TURN share the host), so it needs no firewall hole.
- Prod smoke test locally: `bun --bun nuxt build` then run `.output/server/index.mjs` under Bun with
  `NUXT_DB_PATH` / `NUXT_MIGRATIONS_DIR` set — this exercises the exact `bun:sqlite` + migration path
  the container uses.
