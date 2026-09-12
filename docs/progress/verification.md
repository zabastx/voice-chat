# Verification matrix

Evidence for the ✅ rows in [features.md](features.md): what was actually driven, where, and what
it proved. The last section lists what is still **not** verified. Part of
[PROGRESS.md](../PROGRESS.md).

## Desktop 0.1.0-alpha.1 — the real draft release run (issue #13)

2026-09-12, GitHub Actions `windows-latest`, run
[34700318269](https://github.com/zabastx/voice-chat/actions/runs/34700318269) — the full workflow passed
end to end against the real `desktop-release` environment, the real signing secret and the real
repository variables. This is the run issue #12 could only static-check.

It was driven through the new `workflow_dispatch` path from `test/desktop-release-dispatch` (the desktop
commits plus the integration fixes below), with `tag=desktop-v0.1.0-alpha.1`. `guard` accepted the input
tag without the master-ancestry check, `quality` passed every gate (Formatting, Lint, Typecheck, Tests,
Rust formatting, Rust checks, Rust tests) with no signing material, and `release` waited in the protected
environment until approved, then built, signed and uploaded the draft.

What the run produced, read back from the GitHub API:

- A **draft** Release `desktop-v0.1.0-alpha.1` (id 387608522, `draft: true`), not published.
- All five assets: `Voice.Chat_0.1.0-alpha.1_x64-setup.exe` (3 745 552 B), its `.sig` (432 B),
  `Voice.Chat_0.1.0-alpha.1_x64-portable.exe` (14 433 792 B), `latest.json` and `SHA256SUMS.txt`. GitHub
  renamed the spaced local names to dotted ones, and the manifest and checksum name the stored names.
- `latest.json` carries the exact Russian release notes, `version: 0.1.0-alpha.1`, and the signature from
  the signed setup.
- Downloaded the setup from the draft and checked it independently: its SHA-256 is
  `4357113dae0236d693e324722ad1f81fd95f1fcd183e2d8d531070d972360f13`, byte-for-byte the line
  `SHA256SUMS.txt` names. The `.sig` decodes to a minisign signature whose key id
  (`e77eb0323a4a5d1f`) matches the repository variable `DESKTOP_UPDATER_PUBKEY`, and the Ed25519
  signature verifies over the BLAKE2b-512 prehash of the setup — i.e. the artifact was signed by the
  private half whose public half the Desktop Client embeds.

Four defects surfaced only when the workflow actually ran; all are fixed:

1. **CRLF failed every formatting check on Windows.** `core.autocrlf` checked the whole tree out as CRLF
   on `windows-latest`, so `oxfmt --check` reported all 254 files. Added a repo-wide
   [`.gitattributes`](../../.gitattributes) (`* text=auto eol=lf`, binaries unchanged); a fresh clone on
   Windows now passes `fmt:check`.
2. **The shell was never `cargo fmt`'d.** `cargo fmt --check` failed on `bridge.rs`, `main.rs` and
   `notify.rs`. Formatted; 26 Rust tests still pass.
3. **The signing step could not run with the key in the environment.** The Tauri CLI folds
   `TAURI_SIGNING_PRIVATE_KEY` into its own `--private-key`, which collided with the
   `--private-key-path` the script passes and failed every time. The signer call now drops the ambient
   signing variables; its arguments are the only source of truth. Pinned by a test that signs an
   artifact with the variable set.
4. **The manifest step could not read its own draft.** `releases/tags/<tag>` answers 404 while the tag
   has no git ref, so the step that derives `latest.json` and `SHA256SUMS.txt` failed after the draft was
   already created. It now finds the draft in the releases list and fetches it by id.

### The real Release (2026-09-12)

`master` was fast-forwarded onto the desktop line (`c6653bd`) and the real `desktop-v0.1.0-alpha.1` tag
was pushed, running [34703446106](https://github.com/zabastx/voice-chat/actions/runs/34703446106). This
time `guard` passed the actual **tag-from-`master` ancestry check**, and the whole workflow was green:
`quality`, then `release` behind the environment approval. It left a draft, which was then **published**
— the promotion step — after which the Release is `Latest`.

5. **A published `latest.json` pointed at a dead URL.** The manifest was assembled while the Release was
   a draft, so GitHub reported the setup's URL as `.../releases/download/untagged-…/…`; publishing the
   Release moves the asset to `.../releases/download/desktop-v0.1.0-alpha.1/…`, and the `untagged-*` URL
   then answers **404**. The workflow now passes a tag-scoped `--download-root` so `latest.json` always
   names the URL the asset keeps; the already-published `latest.json` was regenerated and re-uploaded by
   hand. (The live feed never read this file — it builds its manifest from GitHub's current
   `browser_download_url` — so no client was ever offered the dead URL, but the member-facing asset was
   wrong until fixed.)

The live Update feed was then driven against the **real published Release** through the production
GitHub catalog ([desktop-catalog.ts](../../server/utils/desktop-catalog.ts) +
[desktop-update.ts](../../server/utils/desktop-update.ts)):

| client version  | target / arch       | result                                               |
| --------------- | ------------------- | ---------------------------------------------------- |
| `0.0.9`         | `windows`/`x86_64`  | `200` — `0.1.0-alpha.1`, tag URL, 432-byte signature |
| `0.1.0-alpha.1` | `windows`/`x86_64`  | `204` (current)                                      |
| `9.9.9`         | `windows`/`x86_64`  | `204` (newer)                                        |
| `0.0.9`         | `windows`/`aarch64` | `204` (unsupported arch)                             |

The `200` body's `windows-x86_64.url` is `.../releases/download/desktop-v0.1.0-alpha.1/Voice.Chat_…-setup.exe`
— the working tag URL; the signature is the one the signed setup carries.

### What this does **not** prove

- **The deployed VPS has not been redeployed with this code**, so `https://chat.zabastx.ru/api/desktop/update`
  still 302s to `/login` (the running prod build predates the public endpoint). The feed was verified
  against the live GitHub API locally, not over the deployed origin.
- **The real-hardware smoke test is undriven by this run** — see the standing list at the bottom of this
  file. Real microphone and headphones, a 30-minute call in the tray, sleep/wake, screen share, DM and
  mention toasts on a real desktop, and the Portable-vs-installed profile behaviours still need a human
  with the devices, per issue #13's acceptance criteria. **This is the main gap #13 closed over.**
- **A real client has not been offered and installed this update** — that is issue #14's job (updating a
  live install to the _next_ alpha).
- **The portable/installed manual acceptance on a clean Windows machine** is still the earlier harness
  evidence, not a fresh-machine run of this draft's artifacts.

## Desktop 0.1.0-alpha.1 — signed release workflow

2026-09-12, local Windows x64. `bun test` ran 67 tests green across 6 files, `bun run typecheck` and
`bun run lint` clean. Both CLI passes were also driven by hand with a throwaway Tauri updater key: `sign`
signed a stand-in setup, and `manifest` read a release JSON carrying GitHub's renamed assets and wrote
`latest.json` and `SHA256SUMS.txt`, whose lines `sha256sum -c` then verified. The manifest URL came out as
`…/Voice.Chat_<version>_x64-setup.exe` — the dot-renamed name GitHub actually stores.

What the checks pin:

- The feed and the assembly share `windowsReleaseAssets()`; a direct test asserts both accept exactly the
  setup + `.sig` + Portable EXE set and reject a Release missing any one of them.
- `test/desktop-release.test.ts` asserts `latest.json` points at the setup's own published
  `browser_download_url` (a dot-renamed name, not the local spaced one), that its signature is exactly the
  content of the `.sig` the signer wrote, that `SHA256SUMS.txt` names the **published** files against the
  built bytes, and that a published asset whose size does not match the built one is refused. An assembly
  whose setup was never signed is refused too.
- The same test parses `.github/workflows/desktop-release.yml`: the only release trigger is `desktop-v*`
  (plus a draft-only `workflow_dispatch` test path); `guard` runs `git merge-base --is-ancestor` against
  `origin/master`; `quality` needs `guard` and runs every gate with `bun install --frozen-lockfile`, with
  no `TAURI_SIGNING_PRIVATE_KEY` anywhere in the job; `release` needs `quality`, names the
  `desktop-release` environment, holds `contents: write`, and exactly one step (the `sign` step) sees the
  two environment-scoped secrets; the draft is `gh release create --draft`, then `gh api` reads the stored
  assets back and `gh release upload` adds the derived manifest and checksum.

**The real draft run has since happened** — see the #13 section at the top of this file for the
end-to-end evidence, the four defects it exposed, and the draft it left (unpublished). Still undriven
from this earlier static pass: the `guard` rejecting a non-master tag against a real push event (the
dispatch rehearsal skips that rule by design), and the real-hardware smoke test.

## Desktop 0.1.0-alpha.1 + v0.26.0 — desktop notifications from the tray

2026-09-12, local Windows x64. Three passes: the two premises measured from inside a real WebView2,
`bun run desktop:check` against a release shell, and the app itself driven in Chromium over both
transports. `cargo test` passed all 26 native tests and `bun test` all 55.

Measured first, because the issue was written on an assumption that did not hold. Both readings come
from the page reporting to a local server on a timer — no debugger attached, so neither is an
artefact of the harness:

- **The Web Notification API is dead in WebView2.** `'Notification' in window` is `true`, then
  `requestPermission()` resolved to `denied` with no prompt and a constructed notification fired
  `error` rather than `show`. Identical with the window visible and hidden. An earlier reading
  through CDP agreed, and was re-taken without it in case Playwright's focus emulation had coloured
  it ([GOTCHAS 31](../GOTCHAS.md)).
- **A hidden client still claims focus.** With the window hidden to the tray,
  `document.hasFocus()` was `true`, `document.visibilityState` `'visible'` and `document.hidden`
  `false` ([GOTCHAS 30](../GOTCHAS.md)).
- **Nothing is throttled while hidden.** The WebSocket stayed open and delivered 12 round trips in
  six seconds, a 1000 ms timer fired at 1014 ms, and eight chained `setTimeout(…, 0)` drained in
  15 ms — so the realtime connection the issue asked about survives the tray, and so does the
  bridge's dispatch queue.

In the release shell (`bun run desktop:check`, 21 contract scenarios against the real Tauri adapter,
every earlier assertion still green):

- The frozen descriptor carries `voice-lifecycle,notifications,window-focus` and exactly four
  operations, and the remote origin still has no usable Tauri `invoke`.
- A notification of exactly the size the Web Release believes is legal was accepted, which is what
  pins the TypeScript and Rust bounds to each other.
- With the client hidden in the tray, the page waited to learn it from the shell, sent one
  notification, and it arrived in **Windows' own Action Center** — read back from
  `ToastNotificationManager.History`, not from the client's log. The AUMID the client registers for
  itself is what makes that work for a Portable copy with no shortcut.
- The log recorded that notifications happened and not a word of what they said, and no notification
  failed or hit the rate limit.

In the app itself — `bun run notify:check` ([scripts/notify-check.ts](../../scripts/notify-check.ts),
two signed-in accounts in Chromium against a running dev server, both transports replaced by
recorders so nothing reaches a real desktop, and every scenario blocked on the message actually
arriving over the reader's own WebSocket first, because a silent zero otherwise proves nothing. The
harness signs in over the API with a session cached under `.data/notify`, so a repeat run spends
neither the login rate limit nor a wait for the login form to hydrate):

| Scenario                                                     | Result                                                      |
| ------------------------------------------------------------ | ----------------------------------------------------------- |
| browser, conversation open on screen                         | no notification                                             |
| browser, DM with the window blurred                          | exactly one, over the Web Notification API                  |
| browser, setting off                                         | no notification                                             |
| browser, permission already refused                          | no notification, and `requestPermission` never called again |
| Desktop Client, conversation open and window visible         | no notification                                             |
| Desktop Client hidden in the tray, DM                        | exactly one, over the bridge and only the bridge            |
| Desktop Client hidden in the tray, mention in a text channel | exactly one, over the bridge                                |
| Desktop Client restored from the tray                        | back to silent on the open conversation                     |

The hidden-client rows are the ones worth reading twice: `document.hasFocus()` was still `true`
throughout them — the check asserts it — and the notification fired anyway, because the page took
the shell's answer instead.

### Not verified

- **Nobody has watched a real toast for a real message.** The Action Center assertion proves Windows
  accepted and displayed the notification, but a human has not seen a DM from a second member raise
  one on their own desktop, nor checked how the Russian text reads at real length in a real toast.
- **Clicking the toast does nothing.** The contract carries no URL by design, and restoring the
  window on activation is not wired up; in a browser the same notification still opens its channel.
- **The rate limit has never actually tripped in a real client** — only in Rust unit tests against
  the clock.
- **The `--tray` cold start** (client launched straight into the tray, before the first document
  loads) is covered by `push_foreground` after navigation but was not driven end to end.
- **`notify:check` is not in CI** — it needs a running dev server and the seeded dev accounts, so it
  is a command someone runs, not a gate that runs itself.
- **The `showNotification` queue overflow** (32 pending operations) is unreachable in practice and
  was never driven; what it protects — `setVoiceActive` recording a value the queue dropped — is
  covered by reading the code, not by a test.

## Desktop 0.1.0-alpha.1 — installed update

2026-09-11, local Windows x64, two real signed NSIS installers built from this working tree
(`0.1.0-alpha.1` and `0.1.0-alpha.1.1`, the second one only differing by a Tauri config version
override). `cargo test` passed all 20 native tests, and `bun run desktop:installed-update-check`
drove the installed client against a loopback fixture feed with a throwaway updater key pair.

Verified in the real installed client:

- The offer read back exactly the Russian message the shell formats, above «Установить» and
  «Отложить», in that order.
- «Отложить» left `desktop update postponed` in the log, requested the installer asset zero times,
  and left the installed version untouched.
- The remote page could not reach the updater: `invoke('plugin:updater|check')` answered
  «Command plugin:updater|check not allowed by ACL», and the bridge descriptor still carried only
  `desktopVersion`, `bridgeVersion`, `capabilities` and `setVoiceActive`, which refused a
  non-boolean.
- An installer signed with a different key was downloaded and then refused:
  `desktop update install failed`, the installed version unchanged, the client still running.
- With the page reporting a live Voice Channel, the agreed install logged
  `desktop update waiting for voice channel` and requested nothing for fifteen seconds — three poll
  intervals — while the client kept running.
- Clearing the flag downloaded the signed installer, exited the client, replaced it with
  `0.1.0-alpha.1.1`, and the restarted client both checked in with its new version and loaded the
  Web Release carrying the same Sign-in cookie.
- Uninstalling the updated client removed the application, the shared profile and the roaming
  profile.
- Coordinator tests cover the deferral itself without waiting out any clock: a call that ends after
  three polls installs once, no call installs immediately, and a call that never ends returns the
  update to the next check rather than installing or holding the coordinator.

Not yet verified: a real published Release fetched over HTTPS (the harness serves loopback HTTP
through the compile-time allowance), six real hours between checks, sleep/wake across a deferral, an
update agreed during a real LiveKit call rather than a page-driven flag, and Authenticode signing.

## Desktop 0.1.0-alpha.1 — Portable update offer

2026-09-11, local Windows x64, real release-mode Portable EXE. `cargo test` passed all 16 native
tests, and `bun run desktop:update-check` built the artifact against a loopback fixture feed and
drove it through four launches, answering the native offer through UI Automation and a `BM_CLICK`
on the exact Russian label (GOTCHAS 28). The harness uses a compile-time-only loopback HTTP
allowance so it needs no trusted test certificate; ordinary release builds still reject non-HTTPS
origins and Release URLs.

Verified in the real executable:

- Every launch queried the feed once at startup with `target=windows`, `arch=x86_64`, and the
  binary's own `0.1.0-alpha.1` version.
- The offer read back exactly the Russian message the shell formats — version, fixture notes, and
  the manual-replacement question — above «Открыть выпуск» and «Отложить», in that order.
- Launch 1 pressed «Отложить»: the log recorded `desktop update postponed`, no Release page was
  requested, and the Portable EXE stayed alive.
- Launch 2 pressed «Открыть выпуск»: the system browser fetched the exact unique `release_url` the
  fixture supplied, exactly once. Portable stayed alive, its SHA-256 hash was unchanged, and neither
  the install directory nor `uninstall.exe` appeared.
- Launch 3 answered with the running `0.1.0-alpha.1`: no dialog appeared within five seconds, no
  Release page was opened, and neither update log event was written.
- Launch 4 answered `503`: the shell logged `desktop update check failed`, showed no dialog, still
  loaded the Web Release, and kept running.
- Coordinator tests cover equal and older versions producing no prompt, SemVer precedence, a cold
  feed failure producing only a diagnostic, concurrent checks collapsing to one,
  and the startup/check/wait-six-hours ordering without sleeping for six wall-clock hours.
- The build embeds `portable` or `installed`, and only the `portable` stamp reaches the manual
  action. This keeps issue #9 from accidentally implementing the signed installed-update path owned
  by issue #10, and keeps an unstamped development build from offering a manual replacement.

Not yet verified: six real hours or sleep/wake between checks; the deployed VPS feed; a published
`desktop-v*` GitHub Release; a member manually replacing a renamed Portable EXE; and the installed
updater/active-call deferral in issue #10.

## Desktop Update feed — server side

2026-09-09. This is the repo's first automated test suite: `bun run test` (Bun's runner, wired into
[ci.yml](../../.github/workflows/ci.yml) after lint and typecheck). 38 tests in
[test/](../../test/), all green.

`test/desktop-update.test.ts` drives the feed over real HTTP — each case starts a loopback
`Bun.serve` around `feed.respond` and fetches it — against the fixture catalog, i.e. the same
interface the production GitHub adapter implements. Covered: a stable Release offered as a Tauri
manifest (version, notes, `pub_date`, exact `release_url`, one `windows-x86_64` platform with signature and setup URL);
a newer prerelease preferred over an older stable; a draft ignored, with and without a publish date;
non-Desktop tags (`v0.25.0`, `relay-v0.4.0`) ignored; malformed versions (`desktop-vbanana`,
`desktop-v0.4`) ignored; an arm64-only Release ignored; a Release missing its `.sig`, one missing its
setup, and one missing its Portable EXE, ignored; nothing eligible → `204`; older client → `200`,
current and newer clients → `204`; a non-Windows target and a non-x64 arch → `204`; an absent or
unparseable client version still offered; the `X-Desktop-Minimum-Version` header present on both `200`
and `204`, absent when unconfigured, and an unparseable configured minimum dropped rather than echoed;
GitHub failing with a cold cache → `503` + a `Retry-After` matching the feed's own backoff; a
signature that will not download → `503`, never a manifest without one; a stale-but-complete offer
still served while GitHub fails; a cache hit within the TTL doing no second read and a refresh after
it; a failed refresh backing off for a full TTL instead of re-hitting GitHub per request, then
recovering; "nothing to offer" cached and recovering; five concurrent clients collapsing into one
catalog read. `test/desktop-version.test.ts` asserts prerelease ordering directly
(`alpha.1 < alpha.2 < alpha.10 < beta.1 < 0.1.0`) and the versions that must not parse.

`test/desktop-catalog.test.ts` drives the production GitHub adapter against a stubbed fetch carrying
a real-shaped Releases payload: field mapping (`tag_name`, `published_at`, `body`,
`browser_download_url`), a draft with a null body and no assets surviving mapping, the token sent only
when configured, a `403` rate limit raised as an upstream failure, a non-list response rejected, a
signature trimmed, and empty/oversized/failed signature downloads refused. It also loads the
committed fixture that `.env.example` and [desktop/README.md](../../desktop/README.md) point at and
asserts it still yields an offerable Release, so those instructions cannot rot as the eligibility
rules tighten.

Driven by hand against the real thing, same day:

- `GET /api/desktop/update?target=windows&arch=x86_64&version=0.0.9` on `bun run dev` with
  `NUXT_DESKTOP_RELEASE_FIXTURE` set returned `200` with the Cyrillic manifest and
  `x-desktop-minimum-version: 0.1.0-alpha.1`, with no session cookie sent. The same URL at
  `version=0.1.0-alpha.1`, at `version=9.9.9`, and at `target=darwin&arch=aarch64` each returned
  `204` with the header intact — so the h3 route really does pass a web `Response` through. The
  fixture-file catalog was also driven directly: it serves the committed fixture, and a fixture path
  that does not exist degrades to the feed's `503` rather than a 500.
- The production GitHub adapter was run against the live API. `zabastx/voice-chat` has no Releases
  yet, so it listed zero and selected nothing (the feed's `204`). Against `ayangweb/EcoPaste`, a real
  Tauri project, it listed 30 Releases, selected the newest, matched
  `EcoPaste_<version>_x64-setup.exe`, and `readSignature` returned its 444-character base64 signature
  — confirming both the asset naming this feed matches and the size bound it enforces.

Not verified: the production-build branch that ignores `NUXT_DESKTOP_RELEASE_FIXTURE` (it is gated on
`import.meta.dev`, and only a `nuxt build` would exercise it); the endpoint against the deployed VPS;
a real published `desktop-v*` Release end to end. The Portable client consumes the manifest in
issue #9; waiting out a Voice Channel and applying the installed update remain issues #10–#12.

## Desktop 0.1.0-alpha.1 — NSIS installer and Portable EXE

2026-09-10, local Windows x64, Tauri 2.11.5, WebView2 Runtime 152.0.4191.66.
`bun run desktop:install-check` ran the actual NSIS setup, installed EXE, Portable EXE and
uninstaller against a temporary HTTPS origin. The existing development profile was moved to a
checked `.data` path before the run and restored in `finally`, so the harness began with no Voice
Chat install or profile and did not consume the real Sign-in.

Verified:

- `desktop:build` produced both expected x64 artifacts: the 8,563,712-byte
  `Voice Chat_0.1.0-alpha.1_x64-portable.exe` with product/version metadata intact, and
  `Voice Chat_0.1.0-alpha.1_x64-setup.exe`. The script copied the unbundled binary before Tauri
  patched the build output for NSIS.
- Silent NSIS installed `voice-chat.exe` and `uninstall.exe` under
  `%LOCALAPPDATA%\Voice Chat` without elevation. The committed config fixes the installer mode to
  `currentUser`, selects Russian strings and states `downloadBootstrapper` explicitly.
- The installed client received a persistent HttpOnly Sign-in fixture and wrote
  `voice-chat:prefs`. After the installed process exited, Portable loaded both values from the same
  identifier-scoped WebView2 profile.
- With Portable hidden in the tray, launching the installed EXE restored that same process. The
  process count across both executable paths stayed at one. The two forms therefore share the
  single-instance identity rather than merely agreeing on a directory.
- Silent uninstall ran while that Portable process was still alive. Its pre-uninstall hook sent
  `--exit` through the installed binary and stopped the shared instance before removing
  `%LOCALAPPDATA%\Voice Chat`,
  `%LOCALAPPDATA%\ru.zabastx.voicechat` and the corresponding Roaming directory. WebView2 released
  its files shortly after NSIS exited, so the harness waits for the completed removal instead of
  sampling it mid-cleanup.
- The harness installed a second time and uninstalled with no client running. The primary
  `--exit` launch terminated before window creation, so the uninstaller completed instead of
  waiting on a newly started tray process.
- The system WebView2 Runtime remained registered at version 152.0.4191.66 after uninstall. The
  cleanup hook names only the application bundle id and skips `/UPDATE`; it contains no EdgeUpdate
  or WebView2 Runtime path.

`test/desktop-packaging.test.ts` keeps the NSIS mode, asset names, shared-instance stop and cleanup
boundary in the normal suite. `ci.yml` also has a `windows-latest` job that runs the destructive
acceptance harness on a disposable profile. That hosted job has not run from this unpushed branch;
issue #13 will record the release-candidate run on a truly fresh Windows runner.

## Desktop 0.1.0-alpha.1 — Native Bridge

2026-09-09, local Windows release EXE, Tauri 2.11.5 / WebView2 152.0.4191.66. `bun run desktop:check`
compiled a temporary HTTPS origin into the release binary and drove the shell through WebView2 CDP;
`bun test` and `cargo test` cover the two halves separately.

One set of contract scenarios ([test/native-bridge-contract.ts](../../test/native-bridge-contract.ts))
runs in both environments: `bun test` resolves them against the browser adapter and against a
candidate shaped like the injected descriptor, and `desktop:check` bundles the same file, evaluates
it inside the real WebView2 and runs it against the object the shell actually froze onto the page.
All 11 scenarios passed in both. They cover: descriptor presence matching the environment, a named
version and integer bridge version, a descriptor page code cannot rewrite, an unknown capability
never claimed, `supports` agreeing with the descriptor, `setVoiceActive` accepting booleans
everywhere, a non-boolean payload rejected, a client without the capability keeping voice working,
a newer bridge exposing only known capabilities, a malformed descriptor read as no Desktop Client,
and a native failure not escaping into the Web Release.

Also verified in the real client:

- The remote page sees a frozen `{desktopVersion: '0.1.0-alpha.1', bridgeVersion: 1, capabilities:
['voice-lifecycle']}` with exactly one callable operation, `setVoiceActive`.
- The bundled error screen, reached through a later failed navigation, has no `voiceChatDesktop` at
  all — the injection script is gated on the trusted origin.
- `__TAURI_INTERNALS__` and `__TAURI_EVENT_PLUGIN_INTERNALS__` do exist on the remote page, but
  `invoke('plugin:opener|open_url', …)` **rejected**: `security.capabilities` is empty, so no plugin
  command is reachable. `location.href = 'voicechat://exit'` from the remote document was still
  refused by the shell's own guard.
- `setVoiceActive(true)` reached the shell: the identifier-scoped log recorded `voice channel
active`, then `voice channel idle` on the transition back.
- Four forged navigations written by the page itself, skipping the injected descriptor, produced
  exactly one `native bridge message rejected` line and no state change, and did not replace the
  document. They include the shape an embed can reach — the right operation and value, without the
  per-process token (`setVoiceActive?value=0`) — plus `installUpdate`, `openLogFolder` and a wrongly
  typed value.

The reverse channel is a cancelled navigation rather than `chrome.webview.postMessage`; the measured
reason, including the probe run that produced it, is [GOTCHAS 26](../GOTCHAS.md).

Reasoned but **not** driven, and worth knowing before #10 consumes the flag:

- The token guard exists because wry hooks only top-level `NavigationStarting`, so a cross-origin
  embed with user activation can navigate the top frame and arrive while the main document is still
  the trusted origin. `cargo test` covers the refusal; nobody has driven a real embed into attempting
  it.
- The injected descriptor sends only on a change of value, because two `location.href` assignments
  in one tick collapse to the last. In this codebase a `false`→`true` transition never shares a tick
  (an awaited `connect()` sits between them), so no signal has been observed lost — but there is no
  ack and no resend. A lost `false` would leave the shell believing a call is live, so #10 must not
  block an update on this flag indefinitely.
- The signal against a real LiveKit call in the Desktop Client; only the synthetic call in
  `desktop:bench` exercises voice at all.
- Any consumer of `Bridge::voice_active` — the updater that reads it is issue #10.

## Desktop 0.1.0-alpha.1 — production shell

2026-09-09, local Windows release EXE, Tauri 2.11.5 / WebView2 152.0.4191.66.
`bun run desktop:check` created a temporary self-signed HTTPS endpoint, compiled that exact origin
into the release binary, and drove the shell through WebView2 CDP plus the Windows process adapter.

Verified:

- The artifact is `voice-chat.exe`; Windows metadata reports product `Voice Chat` and version
  `0.1.0-alpha.1`. The Tauri identifier is `ru.zabastx.voicechat` and supplies the shared profile,
  single-instance identity and `%LOCALAPPDATA%\ru.zabastx.voicechat\logs` path.
- A live loopback HTTP server planted in `VOICECHAT_DESKTOP_URL` was ignored by the release. The
  embedded port was open but deliberately aborted TLS; the WebView still showed the bundled Russian
  «Повторить» and «Выйти» actions instead of that runtime override or WebView2's error page.
- Starting the embedded HTTPS endpoint and clicking «Повторить» loaded its marker in the same
  process. No application restart was used.
- After that successful load, the HTTPS endpoint was stopped and an uncached same-origin navigation
  was triggered. The same local screen returned; restarting the endpoint and clicking «Повторить»
  recovered the same process again.
- `CloseMainWindow()` hid the chat window; a second normal launch restored it; `--tray` hid it;
  another normal launch restored it; the process count stayed exactly one; `--exit` stopped it.
- The identifier-scoped log directory contained one to three `.log` files, each no larger than
  256 KiB. Every file was scanned for URL, cookie and session text and passed. The logger's API only
  accepts fixed lifecycle events, so page text and request data cannot enter it.

The harness generated and removed its CurrentUser test certificate and temporary PFX in the same
run. Not yet driven against the production host: an actual tray-icon left click, each native tray
menu item, and a cross-origin link opening the chosen default browser. Their Tauri handlers are in
place; the prior prototype already proved the underlying left-click/show path. Installer delivery is
covered above; updater behavior remains in issues #9, #10 and #12.

## v0.25.0 — Tauri 2 Windows prototype

2026-09-09, local release EXE, Tauri 2.11.5 / WebView2 152.0.4191.66,
production Nuxt build on localhost:3000. `bun run desktop:bench` joins Tauri and Chrome
to the seeded `bench-voice` channel as two local fixture users. Microphone input is a
synthetic 440 Hz WebAudio stream; received media is muted. No hardware is captured.

One completed exploratory run, private commit of **all Tauri/WebView2 descendants**,
including GPU and audio processes. Each number is a median of three OS samples after
settling and forced page GC, matching the metric in [BENCH.md](../BENCH.md):

| Scenario                             | Private commit, MiB | Working set sum, MiB |
| ------------------------------------ | ------------------: | -------------------: |
| Empty voice-channel view, not joined |               221.2 |                362.2 |
| Two-person audio call, window open   |               240.8 |                428.2 |
| Same call, window hidden in tray     |               239.5 |                433.9 |

**Verdict:** a working shell, but the requested 100–200 MB call budget is not met.
The 1.3 MiB open/hidden difference is too small to claim a memory improvement.
Earlier exploratory call-window samples were 253.6 and 262.4 MiB, so do not treat
239.5 as a guaranteed footprint. No matched Chrome comparison was run; this establishes
an absolute cost, not savings over the web app. CDP and synthetic audio are measurement
overhead, and working-set sums include shared pages.

Verified: login and channel rendering, LiveKit bidirectional RTP, a 15-second hidden-window
interval with sent bytes 207376 → 392873 and received bytes 204243 → 389493, and native
window restoration through the single-instance plugin. `node desktop/tray-check.mjs`
also passes start-in-tray, show, and hide without needing auth or media.

Two harness traps resolved: navigation waits for DOM content plus the target control,
not external-resource `load`; `MainWindowHandle` remains nonzero when hidden because
the single-instance plugin has a `com.voicechat.desktop-prototype-siw` helper window.
The check distinguishes that helper from the chat window. WebView2's document still
reported `visibilityState: visible` while its native host window was hidden.

Local artifacts: `.data/desktop-memory/{idle-voice-window,call-window,call-tray}.json`,
`call-evidence.json`, and `call-window.png`. The scripts are retained in
[desktop](../../desktop/README.md) to reproduce the experiment.
Release build, `bun run typecheck`, `bun run lint`, `bun run fmt`, and Rust formatting passed.

Not verified: clicks on the native tray menu or close button (Computer Use's native pipe
was unavailable), real microphone/playback quality, PTT, screen-share video/system audio,
device changes, embeds, suspend/resume and long calls. Hide/restore was driven through
the application's CLI, not by clicking the tray. No installer or updater; nothing deployed.

## v0.24.0 — client memory

Measured 2026-09-02 with `scripts/bench/memory.ts` (see [BENCH.md](../BENCH.md)) against a
**production build** on :3000 — the port matters, LiveKit's dev webhooks go there and without them
the call view renders no tiles at all. Two browsers with fake media devices; the measured one is
sampled at the OS level (private commit of the whole Chrome process tree).

**Noise floor first.** The baseline was run twice before any code changed: `total` moved ±3%,
`renderer` ±5% (usually under 1%), `gpu` ±7%, `js heap` ±0.1%. Anything below that is not a result.

**Deltas, `before` (v0.23.0) → `after` (v0.24.0), same seeded content:**

| scenario                         | total            | renderer         | gpu       | js heap        | DOM nodes      |
| -------------------------------- | ---------------- | ---------------- | --------- | -------------- | -------------- |
| busy channel, 150-message window | 343 → 305 (−11%) | 131 → 95 (−28%)  | 133 → 133 | 45 → 12 (−73%) | 14 601 → 4 984 |
| 8 × 30 s voice notes, opened     | 382 → 360 (−6%)  | 157 → 130 (−17%) | 114 → 118 | 11 → 9         | 2 289 → 2 812  |
| quietest channel (the floor)     | 279 → 278        | 85 → 83          | 110 → 120 | 14 → 10 (−31%) | 3 087 → 2 051  |

MB, private commit. Two of those need reading carefully:

- The **floor is not a zero.** `idle` sits in #general, which holds ~20 messages, so the lazy-toolbar
  fix acts there too — that, not noise, is its −31% js heap and its 1 036 fewer nodes. Nothing in
  this build makes an _empty_ app cheaper.
- The **gpu column moves on its own.** It is the noisiest of the four (±7% between two identical
  runs) and none of the three fixes targets it outside a call. Read it only where it is the point,
  which is the call pair below.

**What each number is.** The busy-channel win is the lazy toolbar, and the bench never hovers a row,
so it is that fix's best case — real use mounts a toolbar per hovered message. The voice-note win is
the 8 kHz decode plus releasing the buffer: all eight players still draw their waveform
(`decodedPlayers=8`), so this is not the observer skipping work, it is the same work done cheaper.

**Fix A (`adaptiveStream`) measured on its own.** The first pass credited it with the whole movement
in "in a call, reading a text channel", which was wrong: that scenario navigates to #general, so it
carries the lazy-toolbar win as well, and its js-heap delta (−4.4 MB) was in fact identical to
`idle`'s (−4.5 MB). The scenario now has a control — `no-call-same-channel`, the same channel in the
same session with the call hung up from the sidebar — and the difference between the two is what an
unrendered call actually holds. Re-measured on that pair alone (`before-a` / `after-a`, call suite
only, both freshly built from the same tree):

| held by the call while nothing renders it  | before  | after   | delta              |
| ------------------------------------------ | ------- | ------- | ------------------ |
| total                                      | 41.3 MB | 18.8 MB | **−22.6 MB**       |
| renderer                                   | 15.6 MB | 6.7 MB  | −8.9 MB            |
| **gpu** (where WebRTC decode buffers live) | 19.2 MB | 6.0 MB  | **−13.2 MB, −69%** |
| js heap                                    | 0.3 MB  | −0.8 MB | noise              |

The gpu row is the one that answers the original question: a subscribed camera nobody is looking at
used to keep ~19 MB of decode buffers alive and now keeps ~6. The control moved too (−6.5 MB total,
−9.0 MB renderer) — that is fix C acting on the destination channel, which is exactly what the pair
exists to separate out.

Caveat on the pair: the two halves are two visits to the same channel, not a byte-identical DOM
(node counts differ by ~150 in `before-a` and ~1 000 in `after-a`), so `total` and `renderer` in that
table are approximate to a few MB. `gpu` holds no DOM and is unaffected.

Still measured against a **fake 720p camera**. A real 1080p screen share should be larger and is not
measured: driving `getDisplayMedia` needs a bench scenario that does not exist yet.

**Regression guard.** `call-video-return`: after coming back to the call view, `liveVideoElements`
is 1 again, in both the full run and the isolated one. A paused subscription that never resumed
would have looked like a win in every number above and like a black tile to a member.

**Within noise, as expected.** `call-audio` and `call-video` hold the same tracks before and after:
in the isolated run they moved +0.4% and −1.5% on total. (In the first, full run `call-audio`'s
renderer read +6.7%, above the stated ±5% renderer floor — the isolated re-run puts it at +0.4%, so
that was a single noisy sample, not a regression.)

**Functional check, same build.** A 30 s note reports `duration: 30` and 48 bars, plays
(`currentTime` 2.4 s, label «0:02»), pauses, and seeks — clicking at 80% of the waveform lands at
24.0 s. In the busy channel, zero toolbars are mounted on load; hovering one message mounts exactly
one, with its four buttons.

**The app's own recordings, driven through the UI.** The bench seeds WAVs, which carry their length
in the header — so the interesting container was never exercised by it. Recorded a real ~5 s note in
a throwaway channel with the composer's microphone button (MediaRecorder, `audio/webm;codecs=opus`,
no duration in the container) and drove it twice: the pre-send preview off the blob resolved
`duration: 4.92`, drew its 48 bars and had an enabled play button; after sending and a full reload,
the stored attachment did the same over HTTP and played (`currentTime` 1.94 s, «0:01»), with no
disabled control anywhere in the message. The throwaway channel was deleted afterwards, so the
seeded corpus is unchanged and older baselines stay comparable.

**The stuck-loading defect this found (fixed in the same version).** The first cut of the rewrite
gated the play button on knowing the duration, and the duration on a seek probe that nothing
guarantees will answer — so a clip whose length never resolved was permanently unplayable, where the
old full decode had always produced one. Playability and length are now two questions: `loading` is
`!ready && !durationKnown`, `ready` comes from the element's own `canplay`, and the probe is bounded
by a 4 s timeout that gives up on the length without giving up on the clip (the label reads 0:00 and
the wave can't be scrubbed until the waveform decode fills it in). No test drives the never-answers
path — it is guarded by construction, not by evidence.

**Not covered.** Screen share, Firefox and Safari, mobile, and long-lived sessions — nothing here
says anything about a leak over hours, only about resting cost. Nor does it cover the voice-note
path this build did **not** make cheaper: `<audio preload="metadata">` still mounts per note, and
for the app's own WebM recordings the duration probe seeks to the end, which pulls the clip. Only
the decoded PCM was removed.

## v0.23.0 — persistent Sign-ins + Sign-in Epoch revocation

Driven 2026-09-02 against the dev stack (Node dev server on :3001, dev Postgres), with two
Playwright browsers (`danil` admin, `maks`) plus curl cookie jars standing in for extra devices.

**Cookie shape — both branches.** `Set-Cookie` compared directly off `/api/auth/login`:
`remember: true` → `Expires=Thu, 07 Oct 2027` (the 400-day cap); `remember: false` → no `Expires`
attribute at all, i.e. a browser-session cookie exactly as before v0.23.0; field omitted → remembered,
confirming the default-on decision holds for any caller that doesn't send it.

**Login form.** `input[name=remember]` present and `checked: true` on first paint, labelled
«Запомнить меня»; login through the form lands on the channel view.

**«Выйти со всех устройств» (own).** Two danil devices, both 200 → clicked in Настройки → Профиль →
confirm «Выйти везде»: epoch 6→7, the browser lands on `/login`, and the _other_ device 401s. The
confirm copy renders as written.

**Admin cutoff.** maks signed in on two devices; danil opened Приглашения и участники → Участники →
the new per-row button, whose confirm dialog reads «Завершить все сеансы maks?». On confirm: maks's
epoch 1→2, both maks devices 401, danil unaffected (200). Admin's own row correctly has no button.

**WS disconnect on bump.** danil's members panel went «В СЕТИ — 2» → «В СЕТИ — 1» (only zabastx
left) within seconds of the cutoff — the server really closed maks's socket rather than leaving a
revoked device streaming. This is the observable that matters; the socket itself can't be inspected
from the page.

**Password change.** danil on two devices; changing the password from device A left A signed in
(200) and killed B (401), epoch 1→2. Restoring the password bumped again and again left A alive.

**Authorization.** maks → danil cutoff = 403; anonymous → cutoff = 401; anonymous →
`/api/me/sign-out-all` = 401.

**`/api/auth/refresh` cannot resurrect a revoked cookie.** The middleware skips `/api/auth/*`, so
this was tested directly: bump the epoch in SQL (leaving the browser's cookie untouched), then POST
`refresh` → 401, and the cookie stays dead. Before the route carried its own epoch check it would
have re-sealed the cookie under the current epoch and handed access back.

**Pre-0012 cookies are rejected.** Two cookies sealed by hand with the app's own session password
([scratch script], iron-webcrypto, same seal format): one carrying the correct `signInEpoch` → **200**
(so the forgery format is valid and the app accepts it), the same payload with the field absent →
**401 «Сеанс завершён — войдите заново»**. That is the rollout claim — everyone signs in once after
deploy — verified rather than assumed.

### Re-driven 2026-09-02 after the code review

A two-axis review found the renewal branch was broken; it was fixed and the whole feature re-driven.

**Spec 6 (rolling window) — was broken, now fixed and driven.** `replaceUserSession` does **not**
reset `session.createdAt`: `clear()` drops the context entry and writes an empty _response_ cookie,
but the _request_ cookie survives, so the next `getSession` re-unseals it and `Object.assign`s the
old `createdAt` back — `if (!session.id)` is then false and `createdAt = Date.now()` never runs.
Measured before the fix: two re-issues 5s apart both returned `Expires=Thu, 07 Oct 2027 02:31:00 GMT`,
byte-identical — i.e. exactly the fixed 400-day-from-first-login window the spec rejected. `issueSignIn`
now passes `cookie: { expires }` explicitly (h3 spreads `config.cookie` last, so it wins) and
`runtimeConfig.session.maxAge` became a long seal backstop, since `unsealSession` independently
rejects on `Date.now() - createdAt > maxAge` and would have hit a hard wall regardless. After the fix,
two re-issues 6s apart: `02:34:59` → `02:35:05`. See GOTCHAS #24, rewritten — its original prescription
(«use replaceUserSession») was wrong.

**Renewal threshold — driven for the first time**, with `SIGN_IN_RENEWAL_MS` temporarily at 5s
(restored afterwards). Below the threshold a request returns **zero** `Set-Cookie` headers, which is
the whole point of having a threshold; past it the cookie is re-issued with the expiry moved (+8s).
The negative case matters more: an **unremembered** Sign-in left 8s past the same threshold also
produced zero `Set-Cookie` and stayed authed — renewal never promotes an opt-out session into a
persistent one.

**Full regression after the fix**, all passing: both cookie branches (400-day `Expires` vs none);
own sign-out-all across two devices (epoch 0→1, both 401); password change (changing device 200,
other 401, restore clean); admin cutoff scoped to the target (maks 401, danil 200); authorization
(non-admin 403, anonymous 401); `refresh` refusing to resurrect a revoked cookie (401); pre-0012
rejection against a valid-forgery control (control with epoch → 200, same payload without → 401
«Сеанс завершён — войдите заново»).

**Browser re-run**, both flows through the real UI: checkbox present and `checked: true` on first
paint; admin cutoff via ManageModal (confirm «Завершить все сеансы maks?» → epoch 1→2, presence
«В СЕТИ — 2» → «В СЕТИ — 1», maks 401); own sign-out-all via Настройки → Профиль (epoch 4→5, browser
lands on `/login`, second device 401).

Two other review findings fixed in the same pass: the session fields were declared **required** in
`shared/types/auth.d.ts` while the code's whole purpose is handling cookies that lack them (making
them optional immediately surfaced two `boolean | undefined` call sites that had been silently
wrong), and `bumpSignInEpoch`'s `?? 0` fallback would have sealed a cookie at a fabricated epoch 0 —
a valid epoch for a member still at 0, i.e. a revocation that revoked nothing. It now throws.

### Found and fixed during the first run

- **«Выйти со всех устройств» did not leave the page.** The epoch bumped and other devices died, but
  the browser stayed on the channel view: the handler navigated to `/login` without clearing the
  _client-side_ session state, so `auth.global.ts` saw `loggedIn === true` and bounced it straight
  back — leaving a live-looking UI whose every request 401s. Fixed by mirroring `SelfPanel`'s
  logout (`stop()` on the realtime socket, then `clear()`, then navigate); re-driven, now lands on
  `/login`.

### Not verified

- **A real 400-day expiry**, for obvious reasons — only the `Expires` header value was checked, and
  the rolling behaviour was driven at a 5-second threshold rather than a 7-day one.
- **What a revoked member's open tab looks like.** After a cutoff the other client keeps its
  client-side session state and only discovers the revocation as 401s on its next requests; it is
  not pushed to `/login`. Same shape as the pre-existing deleted-member path, so not new in v0.23.0,
  but more reachable now that a cutoff exists.

## v0.22.0 — VK as a second notification transport

Driven 2026-08-26, against the live VK community and the dev database.

**Against a real VK community** (via `scripts/vk-reply-spike.ts`, before writing any of it):

- `reply_message` arrives on a 1:1 user↔community `message_new` carrying seven populated fields,
  including **both** `id` and `conversation_message_id`, both matching the probe — byte-identical
  from the web and Android clients. This is what makes reply-to-send buildable at all.
- The «Начать» press delivers `ref=<token>` alongside `payload={"command":"start"}`, so linking
  is one tap.
- `message_allow` fires with an **empty** `key`, so the token has to come from `ref`.
- Long Poll and Callback deliver identical event objects; Callback was driven end-to-end through an
  ngrok tunnel (handshake, secret rejection, delivery, reply routing).
- From the **prod host**: `api.vk.ru` → 200, `lp.vk.ru` → 403 on its bare root, both over IPv4.
  No relay needed.

**Against the app:**

- A synthetic `message_new` carrying a reply to a seeded mapping posted into `#general` authored as
  the mapped member with `source='vk'`, Cyrillic intact.
- The two-step migration carries data before dropping anything: verified on a scratch database
  seeded with a linked member, a linked-but-muted member (the disabled preference survives), a
  member holding an unconsumed token, and one who never touched Telegram (no row at all).
- Unknown transport segment 404s; minting a VK token returns the deep link and stores it unlinked.
- **Privacy invariant holds**: no external id and no link token in `/api/members`, `/api/dm`, or the
  session cookie.

**Driven end to end in one run (two Playwright sessions + the real VK community):** the settings
modal shows a card per configured transport; «Подключить VK» mints a token and produces
`vk.me/club<id>?ref=<token>`; tapping it links the account (`external_id` set, token consumed);
the VK badge appears against that member and no other; with the member offline, a mention from a
second account delivered a real VK message and recorded a mapping row carrying both ids; replying
to it in VK posted `pong` into `#general` authored as the linked member, badged «через VK».

Three defects surfaced only here, all fixed:

- **Two app instances each handled every event.** VK gives the same updates to every poller sharing
  a key, so one consumed the single-use link token and the other told the member it had expired.
  Now an advisory lock elects one poller (GOTCHAS 22).
- **VK linkified `@danil`** into `[id7074907|@danil]`, a mention of an unrelated VK account that VK
  would also notify. `disable_mentions` is now set (GOTCHAS 23).
- **A VK reply was badged as a native send** — the source badge was hardcoded to Telegram.

Also settled, having been open since the research pass: **`ref` is delivered when the member
_continues_ an existing conversation**, not only on a first «Начать». Re-linking works without the
Start button, which never appears once a dialog exists.

**Attachment forwarding driven 2026-08-26.** A 64×64 PNG and a `voice-message-*.webm` sent with a
mention arrived in VK as one message carrying `photo(...)` and `doc(voice-message-test.webm)` —
confirming both upload paths, the document fallback for voice, and that text plus attachments ride
a single `messages.send` producing exactly one mapping row.

That run also corrected an earlier claim: `disable_mentions` stops VK notifying the stranger whose
screen name collides with an app username, but it does **not** stop VK rendering `@danil` as a link
to them. The body still shows that link (GOTCHAS 23). Cosmetic, unfixed.

**Still not verified:** a video attachment (only images and the document path were driven), and an
attachment large enough to exercise the size limits.

## Verified locally

Two parallel Playwright browser profiles + real MinIO S3:

- Invite gating, first-user-admin, login/logout, admin-only 403s
- Chat send/edit/delete live-sync between two clients; unread + read tracking
- Attachments: upload to real S3, presigned serving, 401 logged out, raw-bucket 403 (private),
  object deleted with its message
- **Voice audio actually flowing** between two browsers (mic track subscribed + `<audio>` attached);
  roster visible to a non-participant (webhook → voice-state → WS); mute relay
- Russian SSR renders (login page, sidebar, timestamps)
- **Production bundle** built exactly as the Dockerfile does, smoke-tested under Bun: migrations,
  WS, upload+presign, Russian SSR
- **M1 markdown**: right tags for bold/italic/strike/code/autolink; `<script>`, `javascript:` links,
  `<img onerror>` all inert; no hydration mismatch
- **M2 @mentions**: autocomplete filters + inserts, `@name`→`<@id>` encode, live-name chip;
  round-trips incl. Cyrillic, longest-match wins, `a@danil` not a mention
- **M3 replies**: quoted parent (author + decoded preview), click scrolls + flashes, deleted parent
  → «исходное сообщение удалено» live and after reload
- **M4 reactions**: quick-react chip with count + "me" styling, `<emoji-picker>` upgrades,
  chip click toggles off
- **M5 search**: ranked results with `<mark>` (incl. Cyrillic query), click jumps + flashes,
  index stays live on insert/delete
- **v0.17.1 live newcomer**: with danil's tab open and never reloaded, registering `novichok`
  through an invite in a second browser flips the members panel to «В сети — 2» with the new row
  (was: absent from both sections until F5). Blast radius of the missing broadcast was everything
  sourced from the client member directory — panel row, chat avatar, `@` autocomplete, DM picker;
  chat author name and the DM sidebar row were never affected (they read `message.authorName` and
  the server-embedded `convo.member`)
- **v0.17.2 live removal**: with maks parked _inside_ the DM and never reloaded, danil deleting
  `udalyaemyi` drops them from the panel («В сети — 3» → «2»), removes the DM row, and bounces maks
  to the first text channel; the removed member's own tab flips to «подключение…» and its
  `/api/ws/ticket` + `/api/dm` both 401
- **v0.17.3 message purge**: `boltun` posts 4 messages in #general, maks replies to one and
  `boltun` reacts to that reply. Deleting `boltun` clears all four posts from maks's never-reloaded
  tab, flips the surviving reply's quote to «исходное сообщение удалено» and drops the 👍 chip —
  the last two are the cases local `authorId` filtering provably cannot reach
- **v0.18.1 auth form validation**: tabbing through empty fields on `/login` and `/register` no longer
  paints them red; submitting empty shows the Russian schema messages (was the zod default
  «Invalid input: expected string, received undefined», because `UAuthForm` seeds state from
  `field.defaultValue`, i.e. `undefined`); typing clears that field's error live after 300 ms
- **v0.19.0 YouTube embeds**: `watch?v=…&t=30` renders a 446x251 card and click-to-play navigates a
  `youtube-nocookie` iframe with `start=30`; a real Short renders 198x352 with the vertical frame
  filling it; `<https://youtu.be/…>` and a link inside a code span both render with no card;
  «Смотреть вместе» is absent outside a voice channel and, from inside `lounge`, starts a real
  synced session on that video (mini player docked, TV badge on the channel row)
- **Crawler blocking**: against the running dev server, `/login` and `/robots.txt` both carry
  `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, notranslate, noai, noimageai`
  and the SSR HTML carries the matching `<meta name="robots">`. The **real** `deploy/Caddyfile` was
  then run in a `caddy:2` container (`caddy validate` green, `DOMAIN=localhost`): `GPTBot`,
  `ClaudeBot`, `CCBot`, `meta-externalagent` and `AhrefsBot` get **403**, while a browser UA, `curl`,
  `TelegramBot` **and `GPTBot` asking for `/robots.txt`** all fall through to the proxy instead —
  502 there only because `app:3000` doesn't exist in the test container, which is exactly what
  proves the request was routed rather than blocked. The security `header` block still applies to
  the 403 responses
- Settings modal: display name propagates live (old messages/SelfPanel), avatar
  upload→MinIO→presigned (5 render sites), wrong-password 400, mic level meter,
  localStorage prefs, Esc close

## Verified on the deployed VPS

Screen-share video between two real desktop browsers; the live `docker compose up` stack itself.

## v0.9.1 security/perf hardening

Verified locally, dev server + MinIO:

- Session revalidation middleware ([session-member.ts](../../server/middleware/session-member.ts)):
  deleting a member revokes their session (channels/voice-token/ws-ticket → 401); public routes
  still work with a stale cookie
- Login + register rate-limited (10 / 15 min per IP, [rate-limit.ts](../../server/utils/rate-limit.ts)) — 429 verified
- Register in a single transaction — invite can't be consumed twice (400 on reuse)
- Non-media uploads forced to download on redirect and `?proxy` paths
  (`Content-Disposition: attachment` + nosniff) — doesn't render inline
- Chunked upload without Content-Length → 411; Caddy `request_body max_size 30MB` + security headers
- S3 objects (incl. WebP previews) deleted with channel/member deletion, not just rows. Member
  deletion also takes their `kind='dm'` channels (the `channels` row has no member FK, so those
  survived every deletion with one participant — invisible via `dmConversationDto`'s null, but
  accumulating). The S3 sweep covers both participants: dropping the channel cascades the
  **surviving** member's messages away too, and their attachment keys are not in the `uploader_id`
  query. Verified with a file uploaded from each side — both left the bucket, DB rows and MinIO
  objects still 5/5 in sync afterwards
- Channel-list query → correlated index-seek subquery; new indexes on `attachments.message_id`
  and `messages.reply_to_id`
- Hourly stale-upload sweep (was boot-only); redirects carry `Cache-Control: private, max-age=240`;
  WS ticket-map purge + 10 s auth timeout
- Pagination cursor id tiebreaker (`before` + `beforeId`) — same-millisecond rows not skipped

## v0.9.2 message virtualization

Real browser, 400-message-seeded channel: DOM held at ~150 nodes scrolling both directions, scroll
position anchored across every load/trim, no console errors; reached the true top and returned to
the live tail re-pinned; jump-to-message loads an around-window + flash, scrolling down reloads
newer. Server gained `after`/`afterId` forward cursor + `hasMoreNewer`.

## v0.10.0 moderator role

Verified locally: 18-check API smoke passes — member 403s; a pre-promotion cookie works immediately
after promote; channel delete / password reset / role change stay 403 for moderators; admin role
immutable (400); demotion cuts powers on the next request. Migration on a dev-DB copy: `is_admin`
dropped, roles mapped. Two browsers: promote/demote flips maks's UI live (buttons, dropdown, manage
modal read-only roster, «модератор» badge both clients).

## v0.12.0 Postgres migration

Verified locally, `postgres:18-alpine`: fresh-DB boot applies baseline + seeds
admin/`#general`/`lounge`; two parallel registrations on empty DB → exactly one admin
(`pg_advisory_xact_lock`), invite create→use→reuse-400 re-verified; tsvector Russian stemming
(«книга» finds «книгу»), multi-term AND, Latin prefix match; ETL rehearsal on the real dev SQLite —
all counts match, roles/timestamps intact, migrated login works, tsvector self-populated, re-run
refused on non-empty target; Bun-dev WS gotcha re-tested before locking the driver (still broken).

## v0.16.0 Telegram icon

Two Playwright browsers: linking maks + reload → icon with tooltip «Получает уведомления в Telegram»
in both member sections; toggle off/on and unlink each flip the icon live in danil's panel via
`member.updated`; `GET /api/members` returns exactly old DTO keys + `telegramNotifications` (no chat
id / token); malformed PATCH → clean 400. Not driven: real `/start` deep-link (needs relay + bot);
shares the broadcast code path.

## v0.17.0 screen-share preset dialog

**Pending verify.** Click `monitor-up` in call bar → `ShareSettingsModal` opens with default «Текст и
презентации»; select «Видео и игры» or «Без сжатия» → «Начать» → browser `getDisplayMedia` picker →
share tile appears for the remote peer; stop share → click again → dialog pre-fills the previous
preset (persisted in `Preferences.screenSharePreset`); cancel at dialog or browser picker leaves
`sharing=false` with no spurious toast; sidebar `VoicePanel.vue` opens the same modal.

## v0.18.0 Watch Together

Two headed Chromium profiles, real YouTube, real LiveKit — 2026-07-30:

- URL handling: `youtube.com/watch?v=`, `youtu.be/…?t=200` (offset honoured — both clients opened at
  `start=200`), `&t=` on the long form; a Twitch link is refused **at the modal** with «Не похоже на
  ссылку YouTube», `aria-invalid` and an error ring, without a round trip
- Both clients render their own iframe at full stage size (no 640×390 flash), and the `allow`
  attribute is the IFrame API's own list **including `autoplay`** — confirming the removed
  `setAttribute` was narrowing it
- Playback agreed within **0.6 s** at steady state; pause from maks froze danil within **0.04 s**;
  resume propagated with «Продолжаем · maks» (neutral phrasing, attributed to the actor, never to
  the observer) as a transient caption **on the player**, not an app-wide toast — re-verified after
  the change: caption present bottom-left, zero toasts, faded within ~2.5s
- **Seek propagates**: maks → 420 s pulled danil from 165 s to 434 s, delta **0.77 s**
- **Late joiner in sync**: maks left, video ran 25 s, maks rejoined **by clicking «Подключиться»**
  (not by reloading — reload takes the fresh `snapshot` path and hides the bug) → delta **1.89 s**,
  stable at 1.85–2.19 s over the next 30 s. Note the deadband is per-client-against-anchor, so two
  clients can legitimately sit up to ~2× tolerance apart
- **Empty room freezes and resumes exactly**: anchor stopped at `positionSec 118.9, paused true`
  the moment the roster hit zero, was **still** 118.9 after 30 s empty, and both clients resumed at
  `start=118` — proving the pause fires from `voiceParticipantLeft`, not LiveKit's 300 s `empty_timeout`
- Stop propagates to both clients with «Совместный просмотр остановлен»; player errors render the
  Russian failure state with a recovery button on both clients rather than a blank frame
- Sidebar «смотрят вместе» icon visible to a member who has **left** the room while others watch
- **Playback speed** syncs both ways (maks -> 2x pulled danil to 2x); at 2x both advance ~2s of
  video per wall second and the delta CONVERGES (3.02 -> 1.51 -> 1.13s) rather than running away —
  that is the rate-scaled drift test working, since unscaled every 3s tick at 2x fires a false
  seek broadcast that drags the room; caption «Скорость 1.5× · maks» confirmed on the observer
- **Mini player**: clicking through to #general kept the _same_ iframe element alive and playback
  continuous (37.5s -> 68.3s -> 75.0s, never restarting); docked 925x639 -> mini 320x180 pinned
  bottom-right; drag landed exactly on the expected pixel and persisted to `watchMiniPos`; a 2px
  press navigated back and re-docked to the identical box

Three defects were found only by driving it, all fixed and each written up in
[gotchas 18f–18h](../GOTCHAS.md): a detached watcher bound to a caller-scoped `computed` (rejoin
without reload → no player), `new YT.Player()` being touched before `onReady` (repeating throw →
stage mounted with no iframe), and the seek/drift discriminator needing to be asymmetric **and** not
having its baseline refreshed by `onStateChange` (seeks were being corrected away instead of
broadcast).

Two gaps found and **not** fixed: the sidebar `VoicePanel` has no «Смотреть вместе» button (screen
share is wired into both bars, this isn't), and there is no direct **replace** — the control-bar
button stops an active session, so changing video means stop-then-start even though the server
supports overwrite.

## v0.20.0 microphone noise gate

Driven headed as `danil` against the dev stack. The DSP was verified **deterministically** in an
`OfflineAudioContext` rather than through a fake microphone — it renders faster than real time and
lets the input amplitude be set exactly, so the assertions are on numbers rather than on "it
sounded right":

- **Gating**: a -80 dBFS "noise floor" renders to exactly `0.000000` RMS; a -17 dBFS "speech"
  burst renders to `0.141421` — precisely `0.2 / √2`, i.e. passed at unity gain, undistorted.
- **Hold**: 20 ms after the loud burst stops, output RMS is `0.000071` = `0.0001 / √2` — the gate
  is still open and still passing the now-quiet signal. 450 ms after (past the 300 ms hold) it is
  `0.000000`. That is the hangover working, measured rather than inferred.
- **Attack**: reaches 99 % of input 7.9 ms after the threshold is crossed — no clipped consonant.
- **No click**: driven with a constant-amplitude source so the output _is_ the gain envelope, the
  largest sample-to-sample step is `4.17e-4`, exactly the theoretical per-sample ramp increment.
  The envelope is continuous.
- **Bypass paths**: `enabled: false` and `thresholdRms: 0` both pass a -80 dBFS signal through at
  exactly `1.00e-4` (unity), confirming an un-opted-in member's audio is untouched.

Then end-to-end in the running app, with `getUserMedia` overridden to hand LiveKit a real
`MediaStreamTrack` synthesised from Web Audio (so the publish/attach path is genuinely exercised):

- Joining `lounge` with `micMode: 'gate'` calls `addModule('/mic-gate-worklet.js')` exactly once and
  constructs one `AudioWorkletNode`, with **zero console errors** and no unhandled rejections.
- The settings meter reads **77** for a tone whose theoretical level is 75.7 — the whole chain
  (worklet RMS → `postMessage` → `rmsToLevel` → UI) is calibrated, not just plausible.
- Threshold marker renders at `45%`, readout says «микрофон открыт».
- Dragging the threshold to 100 flips the readout to «микрофон закрыт» **without a reconnect** — the
  live `port.postMessage` update path works. The meter keeps reading 77 while shut, which is correct:
  it shows the input level so you can still see where your voice sits relative to the marker.
- Mode + both sliders persist to `voice-chat:prefs`; switching to «Шумовой порог» reveals both
  sliders at their defaults (45 / 300 мс).

One UI gap was found and fixed during the run: switching to gate mode while _not_ in a call left
the meter and its "join a channel to tune this" hint hidden, which is exactly when that hint is
needed — the bar and marker now render whenever the mode is on.

**Adversarial review afterwards found 14 issues, all fixed in the same change** — the headed run
above passes on the happy path, which is exactly why it missed them. The four that mattered:
`toggleMute` republishing an unprocessed track after a mic-less join (wide-open mic while the UI
says «Шумовой порог»); an unguarded `stopProcessor` able to leave the RTP sender on a stopped
track (inaudible to everyone, invisible to its owner); the out-of-call meter's 8-bit
quantization floor landing at ~level 25, under the default threshold of 45, on the very meter
used to place it; and a memoised `addModule` **rejection** disabling the gate until the member
rejoined. Also fixed: stale-gate handle clobbering, a leaked mic-test stream, orphaned
`MediaStreamTrack`s and worklet processors on every `restart`, a stereo up-mix that would have
disabled DTX/RED on reconnect, an ungated window while the module fetched at join, a dead meter
after a failed attach, NaN output on zero-length input blocks, a stale first peak on reopening
the panel, and a duplicated prefs watcher under HMR.

The four that could make someone unheard or unfiltered **were then driven headed** on a clean
server, and the DSP re-rendered identically afterwards (same four RMS figures, no `NaN`):

- **Mic denied at join, then granted and unmuted** — the exact republish path. Before: zero
  `addModule` calls, zero nodes, wide-open mic. After: the module loads and a node is
  constructed on the unmute, and the settings meter comes up live at 76 with the gate open.
- **Simulated 502 on the worklet module** — the attach fails, and the mic-test button is
  **visible again** (it used to be hidden whenever the mode said «Шумовой порог», leaving no
  way to check the microphone at all in the one state where it was broken).
- **Retry after that failure** — a second `addModule` call actually goes out (2 attempts, not
  1. and the gate attaches, proving the rejected module promise is no longer memoised onto the
     Room's `AudioContext` for the rest of the call.
- **`{stop: true}` on a retired node** — level posts drop from 5 per 300 ms to 0, so the audio
  thread really does release the processor instead of stranding one per `restart`.
- **Mono destination** — `getSettings().channelCount` is 1 against the default 2, so the
  stereo up-mix that would have disabled DTX/RED on reconnect is gone.
- **Joining with `micMode: 'open'`** makes **zero** `addModule` calls, confirming the
  un-opted-in path is untouched.

Still reasoned from livekit-client's source rather than driven: the guarded `stopProcessor`
failure path (needs a device that dies mid-detach) and the stale-attach handle guard.

Adding `prefetchMicGateWorklet` to an existing `app/utils/` file mid-run triggered
[gotcha #3](../GOTCHAS.md) again (`useToast is not defined` on an unrelated route), so the fixes
above were driven on a second dev server rather than on the poisoned one.

**Gotcha for future runs:** an `audioWorklet.addModule()` fetch shows up in neither
`performance.getEntriesByType('resource')` nor Playwright's network log, even when it definitely
ran. Checking either one reads as "the gate never attached". Patch `AudioWorklet.prototype.addModule`
in-page to observe it.

### Second pass: two browsers, measured at the listener

Everything above measures the gate at the **sender** — the offline DSP, the meter, the envelope.
Nothing had ever checked what the other member actually receives, which is the only thing the
feature is for. Driven with two fake-device Chromium sessions (`danil` speaking, `maks` listening)
in `lounge`, reading RMS off the listener's remote `<audio>` element's `srcObject`. Chromium's fake
microphone is a periodic beep, so a working gate should show bursts, a broken-open one a continuous
signal, and a broken-shut one nothing.

- **The gate is audible at the far end.** Threshold 100 (can never open): the listener receives peak
  RMS `0.000007` — digital silence against a source of `0.39`, about 91 dB of attenuation. Threshold
  45: peak `0.256281`, with 8 of 40 samples above the noise floor. That is the first end-to-end
  evidence that the gate does anything to what anyone else hears.
- **Live threshold, live hold.** Dragging 100 → 45 with the keyboard (55 × ArrowLeft on the slider)
  took effect without a reconnect, persisted to `voice-chat:prefs`, and the readout then alternated
  «микрофон открыт» / «микрофон закрыт» in step with the beep — the hold opening and closing per
  burst, visible rather than inferred.
- **Mid-call device switch with a gate attached** (was undriven; [gotcha 18i](../GOTCHAS.md)): switched
  the microphone from the new control-bar picker while connected and gated. No error toast, zero
  console errors, the readout kept cycling and the level meter kept peaking at 91 — and the listener
  kept receiving gated audio. LiveKit's `restart()` without an `audioContext` is handled.
- **Hidden tab** (was undriven): backgrounded the speaker's page with a second tab and measured the
  listener for 6 s — peak `0.245`, still bursty. The published track _is_ the worklet's output, so
  audio arriving at all means `process()` is still running on the audio thread, which is exactly the
  reason ADR 0010 rejected a rAF loop. Caveat: this does not _separately_ prove the threshold
  comparison still closes while hidden — but the same `process()` call does the comparison and the
  gain ramp, so a running one implies both. (An attempt to separate them by duty cycle failed: the
  fake source is itself bursty at ~15 %, indistinguishable from the gated 20 %.)
- **The wide-open-mic bug is really fixed** ([gotcha 18k](../GOTCHAS.md)). This was the worst of the
  four adversarial-review findings and had only ever been reasoned about, not driven. Joined with the
  microphone **denied** (control bar came up `mic-off`), granted permission mid-session, then clicked
  unmute — the path where LiveKit publishes a **brand-new, unprocessed** track. With the threshold at
  100 the listener received peak RMS `0.000008` and **zero** loud samples: the gate was re-attached.
  Without the fix the listener would have received the full `~0.37` beep while the sender's UI said
  «Шумовой порог». Dropping the threshold to 45 then produced `0.075` bursts, confirming the
  re-attached processor is a working gate and not a dead track.

**Still undriven:** real speech through a real microphone (including whether AGC walks the room floor
into the threshold over a long call), and Safari/iOS.

## v0.21.0 device picker on the voice screen

Driven headed against the local stack (Postgres/LiveKit/MinIO from `compose.dev.yaml`, dev server on
:3001). Three Chromium sessions, because the interesting states differ only by what the browser will
hand over: **real hardware** (permissions granted, actual mics), **fake device**
(`--use-fake-device-for-media-stream`, so the meter has a signal to show), and **denied** (Playwright's
default — no grant at all).

- **Picker renders and is reachable before joining** — «Устройства» sits next to «Подключиться» while
  disconnected, and between the camera and share buttons while connected (icon order confirmed as
  `mic, video, settings-2, monitor-up, tv, phone-off`). Popover shows Микрофон / Динамики / Камера +
  «Все настройки звука».
- **The meter is live, not decorative** — with the fake device the bar moved across 7–8 distinct values
  peaking at 84–91 over 3 s; with real hardware in a silent room it sat at 0, which is the honest
  answer. Closing the popover removes it; reopening brings it back moving, so the capture start/stop
  cycle is clean.
- **Settings deep link lands on «Голос и видео»** — the opened modal's fields are Микрофон / Режим
  микрофона / Динамики / Камера, not the profile panel.
- **Device switch mid-call** — picked «Fake Audio Input 2» while connected: preference persisted, the
  select kept the new value, no error toast, no revert (i.e. `switchActiveDevice` resolved).
- **Camera switch mid-call** — the standing bug: picked the camera while it was live, preference stored,
  camera stayed on, no toast. Before this change the same write reached nothing until a rejoin.
- **No-permission path** — with the microphone denied, the popover shows the hint + «Разрешить доступ»
  and **no** meter, so opening it never fires a prompt. Clicking grant against a hard denial surfaces
  «Нет доступа к устройствам» rather than hanging.
- **Stale id pruning** — planted `micDeviceId: 'bogus-device-id-that-cannot-resolve'`, reloaded: cleared
  to `null`, select back to «По умолчанию», **no toast** (silent at startup, as designed).
- **Settings panel after the refactor** — «Проверить микрофон» still starts a meter (7 distinct values,
  max 72) and still offers «Остановить проверку», so moving it onto `useMicLevel` cost it nothing.

Two bugs were found _by_ this run and fixed in the same change: the popover checked `needsPermission`
before the un-awaited first enumeration resolved (so the meter never started on first open), and
`needsPermission` tested «has an id but no label» — which never matches, because a pre-grant placeholder
has an **empty `deviceId`** as well as an empty label, so the grant button could not appear in the one
state it exists for.

**Gotcha for future runs:** editing a _newly added_ composable mid-session made the dev server SSR-fail
with `usePreferences is not defined` (an auto-import artifact, not a code defect) — it renders clean
after a dev-server restart. Don't chase it as a bug.

### Second pass, after a two-axis code review

The review found three behavioural defects; all were fixed and the fixes driven:

- **Spurious «Микрофон отключён» after granting permission.** The "have we looked before?" flag
  flipped on the first _enumeration_, but pruning is skipped for any list that cannot be trusted (no
  labels = no grant). So the first **trustworthy** look — the one right after the member clicks
  «Разрешить доступ» — counted as "later" and toasted about a device that was already gone before
  the app started. Now tracked per list, on the first trustworthy enumeration. Driven both ways:
  planted a stale id with the microphone denied → granted mid-session → id cleared, select back to
  «По умолчанию», **no toast**. Then planted a _real_ device id and simulated an unplug (patched
  `enumerateDevices` to omit it + dispatched `devicechange`) → cleared **with** the toast. Both
  branches of the Q12/Q17 split now demonstrably work.
- **A dead stop button.** The settings panel's «Остановить проверку» keyed off the _global_ "a stream is
  open" flag rather than "this panel opened it", so with the picker holding the capture the panel
  would offer a stop button whose click did nothing. The meter composable now exposes a per-consumer
  `ownsTest`. Round-trip re-driven: start → meter + «Остановить», stop → meter gone.
- Plus the cleanups: the `'default'`↔`null` translation and the sentinel now live once in
  `useMediaDevices.deviceModel` (they were copy-pasted into both surfaces — the exact drift the
  shared composables exist to prevent, and the subject of gotcha 6); the three device watchers in
  `useVoice` collapsed into one loop over `DEVICE_PREFS`; `revertingDevice` moved to module scope;
  `live` renamed `liveLevelAvailable`; boolean-flag call sites replaced with
  `startListening`/`stopListening`, `startMonitoring`/`stopMonitoring` and
  `refresh({ requestPermissions })`; the unused `size` prop dropped.

Re-driven after those changes: popover renders all three rows, meter still moves on the fake device
(7 distinct values, max 72), mid-call **microphone** switch and mid-call **camera** switch both still
persist with no toast and no revert — i.e. the collapsed loop watcher behaves as the three separate
ones did.

**Still not verified here:** switching between two _real_ microphones/cameras and hearing the change,
a real hardware unplug (both prune branches were driven, but the disappearance was simulated with a
patched `enumerateDevices`), `setSinkId` output switching actually moving the audio, and Firefox
(where the Динамики row is expected to be disabled). These need real hardware — see the standing
list below.

## Not yet verified (needs a human / real environment)

- **Device picker with real hardware (v0.21.0)** — switch between two physical microphones and two cameras mid-call and confirm the other member hears/sees the change; unplug a device mid-call and check the «Микрофон отключён» toast fires against real hardware (both prune branches were driven, but the disappearance was simulated with a patched `enumerateDevices`); confirm Динамики actually moves playback to the chosen output, and that the row is disabled in Firefox
- **DMs end-to-end (v0.13.0)** — two clients: get-or-create idempotency from all four entry points,
  live targeted delivery + ping/desktop notification, non-participant 404 on messages + no WS leak,
  attachments/reactions/replies/edit/delete inside a DM, search excludes DMs, non-participant can't
  fetch a DM attachment, unread → title count
- **Telegram end-to-end (v0.14.0/v0.15.0)** — real bot token + relay: `/start` linking; offline
  @mention and offline DM each deliver exactly one notification (online → none); reply-to-send
  routes to the right channel/DM authored as the linked member; non-reply/media/expired-mapping
  hints; 403 auto-unlink; no chat-id/token leak in `member.updated` or `GET /api/members`.
  v0.15.0: Telegram reply gets the «через Telegram» badge (in-app send none); voice attachment →
  playable Telegram voice with caption; image + file → `sendPhoto` then `sendDocument`, each with
  its own mapping row; >1024 text → separate `sendMessage` then captionless media; all-media-fail →
  text recovered with «(вложение не удалось переслать)» / attachment-only → «(не удалось переслать
  вложение)»; markdown link arrives as clickable bare URL; `source` stays `app` for native sends
  and survives an in-app edit of a Telegram-origin message
- **Watch Together (v0.18.0)** — mostly ✅ verified, see the section above. Still not driven: a
  YouTube **live broadcast** (live-ness detection, no DVR seek-fighting), a **Shorts** URL
  end-to-end, an genuinely **embedding-disabled** video (the bogus-id path was driven instead), a
  real **buffering stall** not being rebroadcast, and mobile/iOS Safari.
- **Noise gate (v0.20.0)** — mostly ✅ verified, see the section above. Still not driven, and each
  needs a human at a real microphone: **real speech** against real room noise (does 45/300 ms
  actually feel right, does it chop word endings, does AGC drift the floor into the threshold over
  a long call); a **mid-call microphone switch**, which relies on LiveKit calling the processor's
  `restart` and reusing the cached `AudioContext` — confirmed by reading livekit-client's
  `restartTrack`, never driven; the **hidden-tab** case, which is the entire reason the gate is an
  AudioWorklet and cannot be shown to work by a foreground browser test; and **Safari/iOS**, where
  `createMediaStreamSource` has history and the `AudioContext` needs a user gesture
- Real NAT traversal — voice from two different networks (phone hotspot vs home Wi-Fi)
- Mobile browsers (esp. iOS Safari voice) — for Watch Together specifically, that `playsinline`
  actually keeps the video in the filmstrip layout instead of forcing fullscreen
- Production Caddy: `request_body`/`header`/crawler-403 blocks parse on the live VPS. The config now
  validates and serves correctly in a local `caddy:2` container (same image as prod), so what's left
  is confirming it on the real host after a `docker compose up -d caddy`
