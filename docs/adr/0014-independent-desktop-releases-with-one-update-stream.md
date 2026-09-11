# 0014 — Independent Desktop Releases with one update stream

Date: 2026-09-09
Status: accepted — feed, installer, and Portable update offer implemented; installed updater and release workflow pending

The `Voice Chat` Desktop Client has a release line independent from the Web Release. Desktop tags
use `desktop-v<version>`, beginning with `desktop-v0.1.0-alpha.1`; Native Bridge compatibility uses
a separate integer beginning at `1`. A routine Web Release therefore requires no Desktop Release,
and web code must feature-detect the bridge version it needs.

There is one Desktop Update stream rather than parallel alpha and stable channels. A small endpoint
on the production server returns the current Tauri updater manifest, while the signed installer and
update assets remain in the public GitHub Release. The client checks at startup and every six hours,
asks before installing, and postpones installation while the Member remains in a Voice Channel.
Every update is signed with the Tauri updater key from the first alpha. Authenticode is deferred for
the private-group alpha but required before calling a Desktop Release stable.

A `desktop-v<version>` tag from `master` builds a draft GitHub Release with only the release job's
minimal repository write permission. Publishing it after a clean-machine smoke test also promotes
it: the server endpoint selects the newest published `desktop-v*` Release, including prereleases,
and ignores drafts. Moving a bad Release back to draft stops new offers; recovery then moves forward
to a higher patch version, without automatic downgrade.

The Web Release feature-detects individual Native Bridge capabilities, so an older Desktop Client
loses only the native affordance it lacks while chat and voice continue to work. The server tracks a
minimum supported Desktop Release separately from the offered update and may require an update only
for a security issue or a truly incompatible protocol change.

The first installer is a per-user NSIS setup for Windows 10/11 x64 using WebView2's downloaded
bootstrapper. Normal launch shows the window, closing it hides it in the tray, and only the explicit
«Выйти» action ends the process. Autostart is deferred and, if added, will be opt-in.

Each GitHub Release carries the NSIS setup, its updater signature, `latest.json`, a SHA-256 checksum,
and a Portable EXE. Portable means no installer: it shares the installed client's profile under
`%LOCALAPPDATA%` rather than carrying Sign-in data beside the executable. It checks the same update
stream but opens the replacement GitHub Release for a manual download instead of trying to replace
its running file. Installed and portable launches share one single-instance boundary; whichever is
already running receives and shows the second launch.

The NSIS uninstaller removes the application, shared WebView2 profile, local settings, and logs. A
subsequent installed or portable launch therefore begins signed out with defaults. It leaves the
system WebView2 Runtime in place because that runtime belongs to Windows and may be shared by other
applications.

The first alpha keeps a static tray icon. DM and mention notifications while the window is hidden
are release requirements: use the existing Web Notification API when it passes WebView2 testing,
otherwise expose only the typed native notification operation defined by ADR 0013.

Before the first alpha is promoted, it must pass a clean Windows install/uninstall, persisted
Sign-in after relaunch, real microphone and headset audio, a 30-minute call in the tray, sleep/wake,
a screen-share smoke test, and a whole-process-tree memory measurement. Promotion of the next alpha
also proves the updater path. Other Web Release features receive a short smoke test; alpha is blocked
by data loss, inability to install/start/update, or broken core chat or voice behavior.

The tag workflow repeats Bun install, typecheck, lint, formatting, Cargo checks, and applicable Rust
tests before signing and bundling. Release notes are written in Russian under «Что изменилось»,
«Известные ограничения», and «Как установить или обновить»; unsigned alpha notes call out the
SmartScreen warning. The existing green headphones icon remains the alpha identity.

A Desktop Release is called stable only after two successful alpha-to-alpha updates, at least two
weeks of group use without a critical problem, the complete matrix above, old/new Native Bridge
compatibility, Authenticode signing, and no measured memory regression from the 239.5 MiB prototype
baseline. Memory reduction remains an optimization direction rather than a numeric stable gate.

Updater signing secrets live in a protected GitHub Environment named `desktop-release`. Quality
gates run before its manual approval, and the signing job alone receives the private key and
password. An encrypted backup outside GitHub is required because losing the key breaks the normal
update path for every installed client.
