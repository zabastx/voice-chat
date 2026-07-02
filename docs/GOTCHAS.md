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

### 14. Screen share can't be tested headless

Headless Chromium has no screen to capture, so the video path is unverified. The publish/subscribe
plumbing is identical to the audio path (which IS verified). Test in a headed browser or after deploy.

## Deploy notes worth remembering

- Two DNS records: `DOMAIN` and `livekit.DOMAIN`, both → VPS IP. Caddy proxies LiveKit _signaling_;
  RTC media flows directly over the UDP range (LiveKit runs on host networking in prod).
- Firewall: 80/443 tcp, 7881 tcp (RTC fallback), 50000–60000 udp (RTC media). Do **not** expose
  3000 or 7880 — loopback/proxied only.
- Prod smoke test locally: `bun --bun nuxt build` then run `.output/server/index.mjs` under Bun with
  `NUXT_DB_PATH` / `NUXT_MIGRATIONS_DIR` set — this exercises the exact `bun:sqlite` + migration path
  the container uses.
