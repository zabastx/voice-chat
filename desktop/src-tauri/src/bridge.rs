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

use crate::{desktop_log::DesktopEvent, record};

/// Bumped by a Desktop Release that changes the shape of the contract, not by a new
/// capability — the Web Release feature-detects those from `capabilities`.
pub const BRIDGE_VERSION: u64 = 1;

/// Everything the remote page may ask this Desktop Release to do. Growing this list is a
/// Desktop Release decision: each entry needs its own operation and its own validation.
pub const CAPABILITIES: &[&str] = &["voice-lifecycle"];

pub enum BridgeMessage {
    SetVoiceActive(bool),
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
    for (key, pair) in url.query_pairs() {
        match key.as_ref() {
            "value" => value = Some(pair.into_owned()),
            "token" => presented = Some(pair.into_owned()),
            _ => {}
        }
    }
    if presented.as_deref() != Some(token) {
        return Incoming::Rejected;
    }
    match (url.path().trim_start_matches('/'), value.as_deref()) {
        ("setVoiceActive", Some("1")) => Incoming::Accepted(BridgeMessage::SetVoiceActive(true)),
        ("setVoiceActive", Some("0")) => Incoming::Accepted(BridgeMessage::SetVoiceActive(false)),
        _ => Incoming::Rejected,
    }
}

/// The bridge state the shell owns on behalf of the remote page.
pub struct Bridge {
    token: String,
    voice_active: AtomicBool,
    reported_rejection: AtomicBool,
}

impl Default for Bridge {
    fn default() -> Self {
        Self {
            // Only ever present in the trusted document's script scope, which a
            // cross-origin frame cannot read. See `script` for why that matters.
            token: session_token(),
            voice_active: AtomicBool::new(false),
            reported_rejection: AtomicBool::new(false),
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
    pub fn script(&self, origin: &tauri::Url) -> String {
        let expected = json_literal(&origin.origin().ascii_serialization());
        let desktop_version = json_literal(env!("CARGO_PKG_VERSION"));
        let token = json_literal(&self.token);
        let capabilities = serde_json::to_string(CAPABILITIES).unwrap_or_else(|_| "[]".into());
        format!(
            r#"(() => {{
            if (globalThis.location?.origin !== {expected}) return;
            let sent = null;
            const descriptor = Object.freeze({{
                desktopVersion: {desktop_version},
                bridgeVersion: {BRIDGE_VERSION},
                capabilities: Object.freeze({capabilities}),
                setVoiceActive(active) {{
                    if (typeof active !== 'boolean') {{
                        throw new TypeError('setVoiceActive принимает только boolean');
                    }}
                    // The shell only cares about transitions, and two `location.href`
                    // assignments in one tick collapse to the last, so never re-send a
                    // value the shell already has.
                    if (active === sent) return;
                    sent = active;
                    globalThis.location.href = 'voicechat://bridge/setVoiceActive?value=' +
                        (active ? '1' : '0') + '&token=' + {token};
                }}
            }});
            Object.defineProperty(globalThis, 'voiceChatDesktop', {{
                value: descriptor, writable: false, configurable: false, enumerable: true
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
    use super::{read_bridge_navigation, Bridge, BridgeMessage, Incoming};

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
        let script = bridge.script(&tauri::Url::parse("https://chat.example.com/").unwrap());
        assert!(script.contains(r#""https://chat.example.com""#));
        assert!(script.contains(r#"capabilities: Object.freeze(["voice-lifecycle"])"#));
        assert!(script.contains("bridgeVersion: 1"));
        assert!(!script.contains("__TAURI"));
    }

    #[test]
    fn gives_each_process_its_own_token() {
        let script = |bridge: &Bridge| {
            bridge.script(&tauri::Url::parse("https://chat.example.com/").unwrap())
        };
        assert_ne!(script(&Bridge::default()), script(&Bridge::default()));
    }
}
