// Desktop notifications for a client that lives in the tray (#11). The Web Notification
// API is present in WebView2 but dead: `Notification.requestPermission()` resolves to
// `denied` without ever prompting, and a constructed notification fires `error`
// (measured 2026-09-12, GOTCHAS 31). So the remote page hands the shell a bounded
// title/body over the Native Bridge and the shell shows the Windows toast itself.
//
// What the page may express is deliberately tiny: two short lines of plain text. No tag,
// no icon, no button and no URL — nothing that lets a remote origin aim a click on the
// member's desktop. Message text never reaches the log either; a line says that a
// notification was shown, never what it said.
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};

use crate::{desktop_log::DesktopEvent, record};

/// One notification, already bounded by `bridge::read_bridge_navigation`.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Notification {
    pub title: String,
    pub body: String,
}

/// How many toasts a stretch of chat may raise before the shell stops relaying them. A
/// busy channel does not reach this; a page stuck in a loop does, and the member's
/// desktop stays usable either way.
const RATE_LIMIT: usize = 12;
const RATE_WINDOW: Duration = Duration::from_secs(60);

/// The Windows toast, behind a seam: the bounds and the rate limit are the part worth
/// testing, and neither needs a real notification to prove.
pub trait Toaster: Send + Sync {
    fn show(&self, app: &tauri::AppHandle, notification: &Notification) -> Result<(), String>;
}

pub struct Notifier {
    toaster: Box<dyn Toaster>,
    recent: Mutex<VecDeque<Instant>>,
    reported_limit: AtomicBool,
}

impl Default for Notifier {
    fn default() -> Self {
        Self::with_toaster(Box::new(PlatformToaster))
    }
}

impl Notifier {
    pub fn with_toaster(toaster: Box<dyn Toaster>) -> Self {
        Self {
            toaster,
            recent: Mutex::new(VecDeque::new()),
            reported_limit: AtomicBool::new(false),
        }
    }

    /// Relays one notification, or drops it when the page is asking too often. Every
    /// outcome is a bounded log line without the notification's text.
    pub fn show(&self, app: &tauri::AppHandle, notification: &Notification) {
        self.show_at(app, notification, Instant::now())
    }

    fn show_at(&self, app: &tauri::AppHandle, notification: &Notification, now: Instant) {
        if !self.allow(now) {
            // One line per process: a page that loops must not fill the bounded log.
            if !self.reported_limit.swap(true, Ordering::SeqCst) {
                record(app, DesktopEvent::NotificationRateLimited);
            }
            return;
        }
        match self.toaster.show(app, notification) {
            Ok(()) => record(app, DesktopEvent::NotificationShown),
            Err(_) => record(app, DesktopEvent::NotificationFailed),
        }
    }

    fn allow(&self, now: Instant) -> bool {
        let Ok(mut recent) = self.recent.lock() else {
            return false;
        };
        while recent
            .front()
            .is_some_and(|at| now.duration_since(*at) >= RATE_WINDOW)
        {
            recent.pop_front();
        }
        if recent.len() >= RATE_LIMIT {
            return false;
        }
        recent.push_back(now);
        true
    }
}

/// Windows shows a toast on behalf of an Application User Model ID, and drops it when the
/// ID is unknown. A Portable copy has no Start Menu shortcut to carry one, so the client
/// registers its own under HKCU — the documented way for an app without a shortcut, and
/// the same identifier the installer and the Portable EXE already share. The NSIS
/// uninstaller removes the key.
#[cfg(windows)]
fn register_app_id(app: &tauri::AppHandle) -> Result<String, String> {
    let app_id = app.config().identifier.clone();
    let key = windows_registry::CURRENT_USER
        .create(format!("Software\\Classes\\AppUserModelId\\{app_id}"))
        .map_err(|error| error.to_string())?;
    key.set_string("DisplayName", &app.package_info().name)
        .map_err(|error| error.to_string())?;
    Ok(app_id)
}

struct PlatformToaster;

#[cfg(windows)]
impl Toaster for PlatformToaster {
    fn show(&self, app: &tauri::AppHandle, notification: &Notification) -> Result<(), String> {
        use tauri_winrt_notification::Toast;

        let app_id = register_app_id(app)?;
        let mut toast = Toast::new(&app_id).title(&notification.title);
        if !notification.body.is_empty() {
            toast = toast.text1(&notification.body);
        }
        toast.show().map_err(|error| error.to_string())
    }
}

#[cfg(not(windows))]
impl Toaster for PlatformToaster {
    fn show(&self, _app: &tauri::AppHandle, _notification: &Notification) -> Result<(), String> {
        Err("desktop notifications are a Windows feature".into())
    }
}

#[cfg(test)]
mod tests {
    use super::{Notification, Notifier, Toaster, RATE_LIMIT, RATE_WINDOW};
    use std::time::{Duration, Instant};

    struct SilentToaster;

    impl Toaster for SilentToaster {
        fn show(
            &self,
            _app: &tauri::AppHandle,
            _notification: &Notification,
        ) -> Result<(), String> {
            Ok(())
        }
    }

    fn notifier() -> Notifier {
        Notifier::with_toaster(Box::new(SilentToaster))
    }

    #[test]
    fn a_burst_of_notifications_stops_at_the_rate_limit() {
        let notifier = notifier();
        let now = Instant::now();
        for attempt in 0..RATE_LIMIT {
            assert!(
                notifier.allow(now),
                "refused notification {attempt} inside the limit"
            );
        }
        assert!(
            !notifier.allow(now),
            "accepted more than {RATE_LIMIT} in one window"
        );
    }

    #[test]
    fn the_rate_limit_forgets_a_window_that_has_passed() {
        let notifier = notifier();
        let start = Instant::now();
        for _ in 0..RATE_LIMIT {
            assert!(notifier.allow(start));
        }
        assert!(!notifier.allow(start + RATE_WINDOW - Duration::from_secs(1)));
        assert!(notifier.allow(start + RATE_WINDOW));
    }
}
