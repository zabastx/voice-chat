// The native half of the Native Bridge (adr/0013). The remote Web Release gets one frozen
// descriptor and a short list of named operations — never a general Tauri `invoke`, and
// never a handle on the updater, shell, filesystem, process or store.
//
// The reverse channel is a cancelled `voicechat://bridge/<op>` navigation, the same
// mechanism the bundled error screen already uses for retry and exit. WebView2's own
// `chrome.webview.postMessage` is not usable here: wry registers the first
// `WebMessageReceived` handler for Tauri's IPC and fails it on any non-string payload,
// which stops WebView2 from calling later handlers; a string payload does reach us, but
// makes Tauri log a parse error into the page console on every call. See GOTCHAS 26.
use std::{
    collections::hash_map::RandomState,
    hash::BuildHasher,
    sync::atomic::{AtomicBool, Ordering},
};

use tauri::Manager;

use crate::{
    desktop_log::DesktopEvent,
    notify::{Notification, Notifier},
    record,
};

/// Bumped by a Desktop Release that changes the shape of the contract, not by a new
/// capability — the Web Release feature-detects those from `capabilities`.
pub const BRIDGE_VERSION: u64 = 1;

/// Everything the remote page may ask this Desktop Release to do. Growing this list is a
/// Desktop Release decision: each entry needs its own operation and its own validation.
pub const CAPABILITIES: &[&str] = &["voice-lifecycle", "notifications", "window-focus"];

/// What a notification may carry across the bridge. Kept in step with
/// `NOTIFICATION_TITLE_LIMIT` / `NOTIFICATION_BODY_LIMIT` in
/// shared/utils/native-bridge.ts, which the desktop check compares against the descriptor
/// this shell injects.
pub const NOTIFICATION_TITLE_LIMIT: usize = 80;
pub const NOTIFICATION_BODY_LIMIT: usize = 160;

pub enum BridgeMessage {
    SetVoiceActive(bool),
    ShowNotification(Notification),
}

pub enum Incoming {
    /// Not addressed to the bridge — an ordinary link, or the error screen's own actions.
    Foreign,
    /// Addressed to the bridge and does not hold up.
    Rejected,
    Accepted(BridgeMessage),
}

/// Reads one `voicechat://bridge/...` navigation. Anything that is not a registered
/// operation, carrying this process's token and a correctly typed value, is refused here,
/// before it reaches state.
pub fn read_bridge_navigation(url: &tauri::Url, token: &str) -> Incoming {
    if url.scheme() != "voicechat" || url.host_str() != Some("bridge") {
        return Incoming::Foreign;
    }
    let mut value = None;
    let mut presented = None;
    let mut title = None;
    let mut body = None;
    for (key, pair) in url.query_pairs() {
        match key.as_ref() {
            "value" => value = Some(pair.into_owned()),
            "token" => presented = Some(pair.into_owned()),
            "title" => title = Some(pair.into_owned()),
            "body" => body = Some(pair.into_owned()),
            _ => {}
        }
    }
    if presented.as_deref() != Some(token) {
        return Incoming::Rejected;
    }
    match url.path().trim_start_matches('/') {
        "setVoiceActive" => match value.as_deref() {
            Some("1") => Incoming::Accepted(BridgeMessage::SetVoiceActive(true)),
            Some("0") => Incoming::Accepted(BridgeMessage::SetVoiceActive(false)),
            _ => Incoming::Rejected,
        },
        "showNotification" => match read_notification(title.as_deref(), body.as_deref()) {
            Some(notification) => Incoming::Accepted(BridgeMessage::ShowNotification(notification)),
            None => Incoming::Rejected,
        },
        _ => Incoming::Rejected,
    }
}

/// The whole of what a remote page may put on the member's desktop: a title and a body,
/// each one line of plain text within a fixed length. Anything else — a missing title, an
/// over-long field, an extra query parameter hoping to become an action — never becomes a
/// notification.
fn read_notification(title: Option<&str>, body: Option<&str>) -> Option<Notification> {
    let title = bounded(title?, NOTIFICATION_TITLE_LIMIT)?;
    let body = bounded(body.unwrap_or_default(), NOTIFICATION_BODY_LIMIT)?;
    (!title.is_empty()).then_some(Notification { title, body })
}

/// Folds every run of whitespace, control characters included, into one space, then
/// measures what is left. The page folds the same way before it sends, so a string that
/// arrives longer than the limit is a page that ignored the contract, not a long message.
fn bounded(raw: &str, limit: usize) -> Option<String> {
    let plain = raw
        .chars()
        .map(|character| if character.is_control() { ' ' } else { character })
        .collect::<String>();
    let text = plain.split_whitespace().collect::<Vec<_>>().join(" ");
    (text.chars().count() <= limit).then_some(text)
}

/// The bridge state the shell owns on behalf of the remote page.
pub struct Bridge {
    token: String,
    voice_active: AtomicBool,
    foreground: AtomicBool,
    reported_rejection: AtomicBool,
    notifier: Notifier,
}

impl Default for Bridge {
    fn default() -> Self {
        Self {
            // Only ever present in the trusted document's script scope, which a
            // cross-origin frame cannot read. See `script` for why that matters.
            token: session_token(),
            voice_active: AtomicBool::new(false),
            // The window is built visible unless `--tray` asked otherwise; `report_foreground`
            // corrects this from the shell's own view before the page can act on it.
            foreground: AtomicBool::new(true),
            reported_rejection: AtomicBool::new(false),
            notifier: Notifier::default(),
        }
    }
}

impl Bridge {
    /// Whether a Voice Channel is live in the remote page. The updater reads it so an
    /// agreed update installs after the call instead of cutting it off.
    #[allow(dead_code)] // consumed by the updater ticket (#10)
    pub fn voice_active(&self) -> bool {
        self.voice_active.load(Ordering::SeqCst)
    }

    /// Applies one reverse operation.
    pub fn handle(&self, app: &tauri::AppHandle, url: &tauri::Url) {
        match read_bridge_navigation(url, &self.token) {
            Incoming::Accepted(BridgeMessage::SetVoiceActive(active)) => {
                self.set_voice(app, active)
            }
            Incoming::Accepted(BridgeMessage::ShowNotification(notification)) => {
                self.notifier.show(app, &notification)
            }
            // A page that skips the injected descriptor and writes its own URL lands here,
            // as does an embed that navigated the top frame without the token. `Foreign` is
            // unreachable from the caller, which has already matched scheme and host, but
            // the classification is shared with the standalone tests.
            Incoming::Rejected | Incoming::Foreign => {
                // One line per process is enough to tell a broken Web Release from a quiet
                // one, and keeps a page that loops from filling the bounded log.
                if !self.reported_rejection.swap(true, Ordering::SeqCst) {
                    record(app, DesktopEvent::BridgeMessageRejected);
                }
            }
        }
    }

    /// A new document replaces the one that reported the call, so the shell must not keep
    /// holding an update back.
    pub fn clear_voice(&self, app: &tauri::AppHandle) {
        self.set_voice(app, false);
    }

    /// Tells the page whether the member can see the window. A Desktop Client hidden in
    /// the tray still reports `document.hasFocus() === true` to its own page (GOTCHAS 30),
    /// so without this the page would suppress every notification it exists to show.
    pub fn report_foreground(&self, app: &tauri::AppHandle, foreground: bool) {
        if self.foreground.swap(foreground, Ordering::SeqCst) != foreground {
            self.push_foreground(app);
        }
    }

    /// Re-states the current answer to a document that has just loaded: a fresh injection
    /// starts out assuming the member is looking, which is wrong for a client that was
    /// started or reloaded while hidden.
    pub fn push_foreground(&self, app: &tauri::AppHandle) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let foreground = self.foreground.load(Ordering::SeqCst);
        let hook = json_literal(&self.foreground_hook());
        // Optional call: the bundled error screen never received the bridge, and evaluating
        // into it must not raise into its console.
        let _ = window.eval(format!("globalThis[{hook}]?.({foreground});"));
    }

    fn foreground_hook(&self) -> String {
        format!("__voiceChatForeground{}", self.token)
    }

    fn set_voice(&self, app: &tauri::AppHandle, active: bool) {
        // Log the transition, not the message: a chatty page cannot fill the bounded log.
        if self.voice_active.swap(active, Ordering::SeqCst) == active {
            return;
        }
        record(
            app,
            if active {
                DesktopEvent::VoiceActive
            } else {
                DesktopEvent::VoiceIdle
            },
        );
    }

    /// The descriptor and the named operations, installed on the trusted origin only.
    ///
    /// Two guards, because neither is enough alone. The `location.origin` check keeps the
    /// descriptor out of the bundled error screen and out of every embed subframe. The
    /// token covers the other direction: wry hooks only top-level `NavigationStarting`, so
    /// a cross-origin embed that navigates the *top* frame with user activation reaches
    /// `handle` while the main document is still the trusted origin. It cannot read this
    /// token, and the token never enters the DOM or a committed URL.
    pub fn script(&self, origin: &tauri::Url, desktop_version: &str) -> String {
        let expected = json_literal(&origin.origin().ascii_serialization());
        let desktop_version = json_literal(desktop_version);
        let token = json_literal(&self.token);
        let hook = json_literal(&self.foreground_hook());
        let capabilities = serde_json::to_string(CAPABILITIES).unwrap_or_else(|_| "[]".into());
        format!(
            r#"(() => {{
            if (globalThis.location?.origin !== {expected}) return;
            const defer = globalThis.setTimeout.bind(globalThis);
            const encode = globalThis.encodeURIComponent;
            const bound = (value, limit) => [...String(value ?? '')
                .replace(/[\s\p{{Cc}}]+/gu, ' ').trim()].slice(0, limit).join('').trim();
            // One cancelled navigation is one slot: two `location.href` assignments in the
            // same tick collapse to the last (GOTCHAS 26), so operations queue and leave a
            // tick between them. The queue is bounded, so a page stuck in a loop grows
            // nothing.
            const pending = [];
            let draining = false;
            const send = (url) => {{
                if (pending.length >= 32) return false;
                pending.push(url);
                if (draining) return true;
                draining = true;
                const step = () => {{
                    const next = pending.shift();
                    if (next === undefined) {{ draining = false; return; }}
                    globalThis.location.href = next;
                    defer(step, 0);
                }};
                defer(step, 0);
                return true;
            }};
            let sent = null;
            let foreground = true;
            const watchers = new Set();
            const descriptor = Object.freeze({{
                desktopVersion: {desktop_version},
                bridgeVersion: {BRIDGE_VERSION},
                capabilities: Object.freeze({capabilities}),
                setVoiceActive(active) {{
                    if (typeof active !== 'boolean') {{
                        throw new TypeError('setVoiceActive принимает только boolean');
                    }}
                    // The shell only cares about transitions, so never re-send a value it
                    // already has. Recorded only once the value is actually on its way: a
                    // full queue that dropped it must not leave the shell holding a stale
                    // answer about a live call, which is what postpones an update.
                    if (active === sent) return;
                    if (send('voicechat://bridge/setVoiceActive?value=' +
                        (active ? '1' : '0') + '&token=' + {token})) {{
                        sent = active;
                    }}
                }},
                showNotification(notification) {{
                    // Folded and cut exactly the way shared/utils/native-bridge.ts does it,
                    // so a caller that reached the descriptor directly cannot hand the shell
                    // a string it will only refuse — and never a split surrogate pair, which
                    // would make `encode` throw instead of notifying anyone.
                    const title = bound(notification?.title, {NOTIFICATION_TITLE_LIMIT});
                    const body = bound(notification?.body, {NOTIFICATION_BODY_LIMIT});
                    if (!title) throw new TypeError('уведомление без заголовка');
                    send('voicechat://bridge/showNotification?title=' + encode(title) +
                        '&body=' + encode(body) + '&token=' + {token});
                }},
                isForeground() {{ return foreground; }},
                onForegroundChange(listener) {{
                    if (typeof listener !== 'function') {{
                        throw new TypeError('onForegroundChange принимает функцию');
                    }}
                    watchers.add(listener);
                    return () => {{ watchers.delete(listener); }};
                }}
            }});
            Object.defineProperty(globalThis, 'voiceChatDesktop', {{
                value: descriptor, writable: false, configurable: false, enumerable: true
            }});
            // Named after this process's token so only the shell can move the value: a
            // cross-origin frame cannot read the name, and page code that guesses it can
            // at worst silence its own notifications.
            Object.defineProperty(globalThis, {hook}, {{
                value: (next) => {{
                    const value = next !== false;
                    if (value === foreground) return;
                    foreground = value;
                    for (const watcher of [...watchers]) {{
                        try {{ watcher(value); }} catch {{ /* one bad listener, not all */ }}
                    }}
                }},
                writable: false, configurable: false, enumerable: false
            }});
        }})();"#
        )
    }
}

/// Whether the document currently loaded in the main window is the trusted origin. Kept
/// alongside the token check: this one alone cannot see which frame raised the navigation.
pub fn is_trusted_document(app: &tauri::AppHandle, trusted: &url::Origin) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.url().ok())
        .is_some_and(|url| &url.origin() == trusted)
}

fn session_token() -> String {
    let state = RandomState::new();
    format!(
        "{:016x}{:016x}",
        state.hash_one("voice-chat"),
        state.hash_one("native-bridge")
    )
}

fn json_literal(value: &str) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| String::from("\"\""))
}

#[cfg(test)]
mod tests {
    use super::{
        read_bridge_navigation, Bridge, BridgeMessage, Incoming, NOTIFICATION_BODY_LIMIT,
        NOTIFICATION_TITLE_LIMIT,
    };
    use crate::notify::Notification;

    const TOKEN: &str = "0123456789abcdef0123456789abcdef";

    fn read(raw: &str) -> Incoming {
        read_bridge_navigation(&tauri::Url::parse(raw).expect("valid test URL"), TOKEN)
    }

    fn accepted(raw: &str) -> Option<bool> {
        match read(raw) {
            Incoming::Accepted(BridgeMessage::SetVoiceActive(active)) => Some(active),
            _ => None,
        }
    }

    /// The URL the injected descriptor builds, with whatever extra parameters a caller
    /// wants to try alongside the two the operation actually has.
    fn notification_url(pairs: &[(&str, &str)]) -> String {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        for (key, value) in pairs {
            query.append_pair(key, value);
        }
        format!("voicechat://bridge/showNotification?{}", query.finish())
    }

    fn shown(title: &str, body: &str) -> Option<Notification> {
        let raw = notification_url(&[("title", title), ("body", body), ("token", TOKEN)]);
        match read(&raw) {
            Incoming::Accepted(BridgeMessage::ShowNotification(shown)) => Some(shown),
            _ => None,
        }
    }

    #[test]
    fn accepts_only_a_named_operation_with_a_correctly_typed_payload() {
        assert_eq!(
            accepted(&format!("voicechat://bridge/setVoiceActive?value=1&token={TOKEN}")),
            Some(true)
        );
        assert_eq!(
            accepted(&format!("voicechat://bridge/setVoiceActive?value=0&token={TOKEN}")),
            Some(false)
        );
        for raw in [
            format!("voicechat://bridge/setVoiceActive?value=yes&token={TOKEN}"),
            format!("voicechat://bridge/setVoiceActive?value=&token={TOKEN}"),
            format!("voicechat://bridge/setVoiceActive?value=true&token={TOKEN}"),
            format!("voicechat://bridge/setVoiceActive?token={TOKEN}"),
            format!("voicechat://bridge/setVoiceActive?other=1&token={TOKEN}"),
        ] {
            assert!(matches!(read(&raw), Incoming::Rejected), "{raw}");
        }
    }

    #[test]
    fn a_notification_carries_nothing_but_a_bounded_title_and_body() {
        let plain = shown("Данил", "привет").expect("a plain notification");
        assert_eq!(plain.title, "Данил");
        assert_eq!(plain.body, "привет");

        // A chat message is ordinary text: newlines and runs of spaces fold into one line,
        // and a control character never reaches the toast.
        let folded = shown("Данил", "первая\nстрока\tи\u{7}вторая   строка").expect("folded");
        assert_eq!(folded.body, "первая строка и вторая строка");

        // An empty body is a message that was only an attachment; an empty title is not a
        // notification at all.
        assert_eq!(shown("Данил", "").expect("title only").body, "");
        assert!(shown("", "тело").is_none());
        assert!(shown("   ", "тело").is_none());
        assert!(matches!(
            read(&notification_url(&[("body", "тело"), ("token", TOKEN)])),
            Incoming::Rejected
        ));
    }

    #[test]
    fn a_notification_longer_than_the_contract_never_reaches_the_desktop() {
        assert!(shown(&"я".repeat(NOTIFICATION_TITLE_LIMIT), "тело").is_some());
        assert!(shown(&"я".repeat(NOTIFICATION_TITLE_LIMIT + 1), "тело").is_none());
        assert!(shown("Данил", &"я".repeat(NOTIFICATION_BODY_LIMIT)).is_some());
        assert!(shown("Данил", &"я".repeat(NOTIFICATION_BODY_LIMIT + 1)).is_none());
    }

    #[test]
    fn a_notification_cannot_smuggle_an_action_or_a_url() {
        // Every parameter but the two the operation declares is dropped rather than read,
        // so a page cannot grow the toast into something that aims a click (adr/0013).
        let raw = notification_url(&[
            ("title", "Данил"),
            ("body", "привет"),
            ("url", "https://example.invalid"),
            ("actions", "открыть"),
            ("icon", r"C:\Windows\System32\cmd.exe"),
            ("token", TOKEN),
        ]);
        let Incoming::Accepted(BridgeMessage::ShowNotification(shown)) = read(&raw) else {
            panic!("a well-formed notification with extra parameters was refused");
        };
        assert_eq!(shown, Notification { title: "Данил".into(), body: "привет".into() });
    }

    #[test]
    fn a_notification_without_this_process_token_never_arrives() {
        for pairs in [
            vec![("title", "Данил"), ("body", "привет")],
            vec![("title", "Данил"), ("token", "guess")],
            vec![("title", "Данил"), ("token", &TOKEN[..8])],
        ] {
            let raw = notification_url(&pairs);
            assert!(matches!(read(&raw), Incoming::Rejected), "{raw}");
        }
    }

    #[test]
    fn refuses_an_operation_the_bridge_never_registered() {
        for raw in [
            format!("voicechat://bridge/installUpdate?value=1&token={TOKEN}"),
            format!("voicechat://bridge/openLogFolder?value=1&token={TOKEN}"),
            format!("voicechat://bridge/plugin:opener%7Copen_url?value=1&token={TOKEN}"),
            format!("voicechat://bridge/?value=1&token={TOKEN}"),
        ] {
            assert!(matches!(read(&raw), Incoming::Rejected), "{raw}");
        }
    }

    #[test]
    fn refuses_a_navigation_that_cannot_present_this_process_token() {
        // What a top-frame navigation raised by an embed can produce: it knows the shape
        // of the URL, but never the token.
        for raw in [
            "voicechat://bridge/setVoiceActive?value=1".to_owned(),
            "voicechat://bridge/setVoiceActive?value=1&token=".to_owned(),
            "voicechat://bridge/setVoiceActive?value=1&token=guess".to_owned(),
            format!("voicechat://bridge/setVoiceActive?value=1&token={}", &TOKEN[..8]),
        ] {
            assert!(matches!(read(&raw), Incoming::Rejected), "{raw}");
        }
    }

    #[test]
    fn leaves_navigation_that_is_not_addressed_to_the_bridge_alone() {
        for raw in [
            "voicechat://retry",
            "voicechat://exit",
            "https://chat.example.com/setVoiceActive?value=1",
            "http://tauri.localhost/index.html",
        ] {
            assert!(matches!(read(raw), Incoming::Foreign), "{raw}");
        }
    }

    #[test]
    fn installs_the_descriptor_on_the_trusted_origin_only() {
        let bridge = Bridge::default();
        let script = bridge.script(
            &tauri::Url::parse("https://chat.example.com/").unwrap(),
            "0.1.0-alpha.1",
        );
        assert!(script.contains(r#""https://chat.example.com""#));
        assert!(script.contains(
            r#"capabilities: Object.freeze(["voice-lifecycle","notifications","window-focus"])"#
        ));
        assert!(script.contains("bridgeVersion: 1"));
        assert!(!script.contains("__TAURI"));
    }

    #[test]
    fn gives_each_process_its_own_token() {
        let script = |bridge: &Bridge| {
            bridge.script(
                &tauri::Url::parse("https://chat.example.com/").unwrap(),
                "0.1.0-alpha.1",
            )
        };
        assert_ne!(script(&Bridge::default()), script(&Bridge::default()));
    }
}
