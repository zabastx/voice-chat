use semver::Version;
use std::{
    cmp::Ordering,
    sync::atomic::{AtomicBool, Ordering as AtomicOrdering},
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use url::Url;

use crate::desktop_log::{DesktopEvent, DesktopLog};

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Clone, Debug)]
struct UpdateOffer {
    version: Version,
    notes: String,
    release_url: Url,
}

trait UpdateSource {
    fn check(&self, current_version: &Version) -> Result<Option<UpdateOffer>, String>;
}

trait UpdatePrompt {
    fn accept(&self, offer: &UpdateOffer) -> bool;
}

trait UpdateAction {
    fn apply(&self, offer: &UpdateOffer) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CheckResult {
    Busy,
    NoUpdate,
    Postponed,
    Applied,
    Failed,
}

struct UpdateCoordinator<S, P, A> {
    current_version: Version,
    source: S,
    prompt: P,
    action: A,
    checking: AtomicBool,
}

impl<S, P, A> UpdateCoordinator<S, P, A>
where
    S: UpdateSource,
    P: UpdatePrompt,
    A: UpdateAction,
{
    fn new(current_version: Version, source: S, prompt: P, action: A) -> Self {
        Self {
            current_version,
            source,
            prompt,
            action,
            checking: AtomicBool::new(false),
        }
    }

    fn check_now(&self) -> CheckResult {
        if self
            .checking
            .compare_exchange(false, true, AtomicOrdering::AcqRel, AtomicOrdering::Acquire)
            .is_err()
        {
            return CheckResult::Busy;
        }
        let _guard = CheckGuard(&self.checking);

        let offer = match self.source.check(&self.current_version) {
            Ok(Some(offer)) => offer,
            Ok(None) => return CheckResult::NoUpdate,
            Err(_) => return CheckResult::Failed,
        };
        if offer.version.cmp_precedence(&self.current_version) != Ordering::Greater {
            return CheckResult::NoUpdate;
        }
        if !self.prompt.accept(&offer) {
            return CheckResult::Postponed;
        }
        match self.action.apply(&offer) {
            Ok(()) => CheckResult::Applied,
            Err(_) => CheckResult::Failed,
        }
    }

    #[cfg(test)]
    fn action(&self) -> &A {
        &self.action
    }
}

struct CheckGuard<'a>(&'a AtomicBool);

impl Drop for CheckGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, AtomicOrdering::Release);
    }
}

trait CheckCadence {
    fn wait(&self, duration: Duration) -> bool;
}

fn run_schedule<S, P, A>(
    coordinator: &UpdateCoordinator<S, P, A>,
    cadence: &impl CheckCadence,
    mut observe: impl FnMut(CheckResult),
) where
    S: UpdateSource,
    P: UpdatePrompt,
    A: UpdateAction,
{
    loop {
        observe(coordinator.check_now());
        if !cadence.wait(CHECK_INTERVAL) {
            break;
        }
    }
}

struct HttpUpdateSource {
    client: reqwest::blocking::Client,
    endpoint: Url,
}

impl HttpUpdateSource {
    fn new(origin: &Url) -> Result<Self, String> {
        let endpoint = origin
            .join("/api/desktop/update")
            .map_err(|error| error.to_string())?;
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .user_agent("voice-chat-desktop-update-client")
            .build()
            .map_err(|error| error.to_string())?;
        Ok(Self { client, endpoint })
    }
}

impl UpdateSource for HttpUpdateSource {
    fn check(&self, current_version: &Version) -> Result<Option<UpdateOffer>, String> {
        let current_version = current_version.to_string();
        let response = self
            .client
            .get(self.endpoint.clone())
            .query(&[
                ("target", "windows"),
                ("arch", "x86_64"),
                ("version", current_version.as_str()),
            ])
            .send()
            .map_err(|error| error.to_string())?;

        if response.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(None);
        }
        if !response.status().is_success() {
            return Err(format!("Update feed returned HTTP {}", response.status()));
        }

        let body: serde_json::Value = response.json().map_err(|error| error.to_string())?;
        let version = body
            .get("version")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "Update feed omitted version".to_owned())
            .and_then(|value| Version::parse(value).map_err(|error| error.to_string()))?;
        let release_url = body
            .get("release_url")
            .and_then(serde_json::Value::as_str)
            .ok_or_else(|| "Update feed omitted release_url".to_owned())
            .and_then(|value| Url::parse(value).map_err(|error| error.to_string()))?;
        let test_loopback_http = option_env!("VOICECHAT_DESKTOP_UPDATE_CHECK") == Some("1")
            && release_url.scheme() == "http"
            && crate::origin::is_loopback(&release_url);
        if release_url.scheme() != "https" && !test_loopback_http {
            return Err("Update release_url must use HTTPS".into());
        }
        let notes = body
            .get("notes")
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default()
            .to_owned();

        Ok(Some(UpdateOffer {
            version,
            notes,
            release_url,
        }))
    }
}

struct PortablePrompt(tauri::AppHandle);

impl UpdatePrompt for PortablePrompt {
    fn accept(&self, offer: &UpdateOffer) -> bool {
        let notes = offer.notes.trim();
        let message = if notes.is_empty() {
            format!(
                "Доступна новая версия Voice Chat {}.\n\nОткрыть страницу выпуска, чтобы скачать и вручную заменить Portable EXE?",
                offer.version
            )
        } else {
            format!(
                "Доступна новая версия Voice Chat {}.\n\n{}\n\nОткрыть страницу выпуска, чтобы скачать и вручную заменить Portable EXE?",
                offer.version, notes
            )
        };
        self.0
            .dialog()
            .message(message)
            .title("Обновление Voice Chat")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Открыть выпуск".into(),
                "Отложить".into(),
            ))
            .blocking_show()
    }
}

struct OpenPortableRelease(tauri::AppHandle);

impl UpdateAction for OpenPortableRelease {
    fn apply(&self, offer: &UpdateOffer) -> Result<(), String> {
        self.0
            .opener()
            .open_url(offer.release_url.as_str(), None::<&str>)
            .map_err(|error| error.to_string())
    }
}

struct SixHourCadence;

impl CheckCadence for SixHourCadence {
    fn wait(&self, duration: Duration) -> bool {
        std::thread::sleep(duration);
        true
    }
}

fn record_result(app: &tauri::AppHandle, result: CheckResult) {
    let event = match result {
        CheckResult::Failed => Some(DesktopEvent::UpdateCheckFailed),
        CheckResult::Postponed => Some(DesktopEvent::UpdatePostponed),
        CheckResult::Applied => Some(DesktopEvent::UpdateReleaseOpened),
        CheckResult::Busy | CheckResult::NoUpdate => None,
    };
    if let (Some(event), Some(log)) = (event, app.try_state::<DesktopLog>()) {
        log.event(event);
    }
}

pub fn start_portable(app: tauri::AppHandle, origin: &Url) {
    // only a build stamped portable opens a Release page by hand: an installed one
    // waits for issue #10, and an unstamped dev build is neither
    if option_env!("VOICECHAT_DESKTOP_MODE") != Some("portable") {
        return;
    }

    let Ok(source) = HttpUpdateSource::new(origin) else {
        record_result(&app, CheckResult::Failed);
        return;
    };
    let Ok(current_version) = Version::parse(env!("CARGO_PKG_VERSION")) else {
        record_result(&app, CheckResult::Failed);
        return;
    };
    let coordinator = UpdateCoordinator::new(
        current_version,
        source,
        PortablePrompt(app.clone()),
        OpenPortableRelease(app.clone()),
    );
    std::thread::spawn(move || {
        run_schedule(&coordinator, &SixHourCadence, |result| {
            record_result(&app, result)
        });
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        sync::{mpsc, Arc, Mutex},
        thread,
        time::Duration,
    };

    #[derive(Clone)]
    struct FixedSource {
        result: Result<Option<UpdateOffer>, String>,
        events: Arc<Mutex<Vec<&'static str>>>,
    }

    impl UpdateSource for FixedSource {
        fn check(&self, _current_version: &Version) -> Result<Option<UpdateOffer>, String> {
            self.events.lock().unwrap().push("check");
            self.result.clone()
        }
    }

    struct FixedPrompt {
        accept: bool,
        shown: Arc<Mutex<Vec<String>>>,
    }

    impl UpdatePrompt for FixedPrompt {
        fn accept(&self, offer: &UpdateOffer) -> bool {
            self.shown.lock().unwrap().push(offer.version.to_string());
            self.accept
        }
    }

    #[derive(Default)]
    struct RecordingAction(Mutex<Vec<String>>);

    impl UpdateAction for RecordingAction {
        fn apply(&self, offer: &UpdateOffer) -> Result<(), String> {
            self.0
                .lock()
                .unwrap()
                .push(offer.release_url.as_str().to_owned());
            Ok(())
        }
    }

    fn offer(version: &str) -> UpdateOffer {
        UpdateOffer {
            version: Version::parse(version).unwrap(),
            notes: "Исправлена доставка обновлений.".into(),
            release_url: Url::parse(&format!(
                "https://github.com/zabastx/voice-chat/releases/tag/desktop-v{version}"
            ))
            .unwrap(),
        }
    }

    fn coordinator(
        offered: Result<Option<UpdateOffer>, String>,
        accept: bool,
    ) -> (
        UpdateCoordinator<FixedSource, FixedPrompt, RecordingAction>,
        Arc<Mutex<Vec<String>>>,
    ) {
        let shown = Arc::new(Mutex::new(Vec::new()));
        let coordinator = UpdateCoordinator::new(
            Version::parse("0.1.0-alpha.1").unwrap(),
            FixedSource {
                result: offered,
                events: Arc::new(Mutex::new(Vec::new())),
            },
            FixedPrompt {
                accept,
                shown: Arc::clone(&shown),
            },
            RecordingAction::default(),
        );
        (coordinator, shown)
    }

    #[test]
    fn accepted_new_release_opens_its_exact_release_page() {
        let (coordinator, shown) = coordinator(Ok(Some(offer("0.1.0-alpha.2"))), true);

        assert_eq!(coordinator.check_now(), CheckResult::Applied);
        assert_eq!(&*shown.lock().unwrap(), &["0.1.0-alpha.2"]);
        assert_eq!(
            &*coordinator.action().0.lock().unwrap(),
            &["https://github.com/zabastx/voice-chat/releases/tag/desktop-v0.1.0-alpha.2"]
        );
    }

    #[test]
    fn postponed_release_does_not_open_or_install_anything() {
        let (coordinator, shown) = coordinator(Ok(Some(offer("0.1.0-alpha.2"))), false);

        assert_eq!(coordinator.check_now(), CheckResult::Postponed);
        assert_eq!(shown.lock().unwrap().len(), 1);
        assert!(coordinator.action().0.lock().unwrap().is_empty());
    }

    #[test]
    fn same_or_older_release_is_not_presented_even_if_the_feed_returns_it() {
        for version in ["0.1.0-alpha.1", "0.1.0-alpha.0"] {
            let (coordinator, shown) = coordinator(Ok(Some(offer(version))), true);

            assert_eq!(coordinator.check_now(), CheckResult::NoUpdate);
            assert!(shown.lock().unwrap().is_empty());
            assert!(coordinator.action().0.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn feed_failure_stays_a_diagnostic_and_does_not_block_the_app() {
        let (coordinator, shown) = coordinator(Err("feed unavailable".into()), true);

        assert_eq!(coordinator.check_now(), CheckResult::Failed);
        assert!(shown.lock().unwrap().is_empty());
        assert!(coordinator.action().0.lock().unwrap().is_empty());
    }

    struct BlockingSource {
        entered: Mutex<Option<mpsc::Sender<()>>>,
        release: Mutex<mpsc::Receiver<()>>,
    }

    impl UpdateSource for BlockingSource {
        fn check(&self, _current_version: &Version) -> Result<Option<UpdateOffer>, String> {
            if let Some(entered) = self.entered.lock().unwrap().take() {
                entered.send(()).unwrap();
            }
            self.release.lock().unwrap().recv().unwrap();
            Ok(None)
        }
    }

    #[test]
    fn overlapping_checks_are_collapsed() {
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let coordinator = Arc::new(UpdateCoordinator::new(
            Version::parse("0.1.0-alpha.1").unwrap(),
            BlockingSource {
                entered: Mutex::new(Some(entered_tx)),
                release: Mutex::new(release_rx),
            },
            FixedPrompt {
                accept: false,
                shown: Arc::new(Mutex::new(Vec::new())),
            },
            RecordingAction::default(),
        ));
        let running = Arc::clone(&coordinator);
        let first = thread::spawn(move || running.check_now());
        entered_rx.recv_timeout(Duration::from_secs(1)).unwrap();

        assert_eq!(coordinator.check_now(), CheckResult::Busy);
        release_tx.send(()).unwrap();
        assert_eq!(first.join().unwrap(), CheckResult::NoUpdate);
    }

    struct RecordingCadence {
        events: Arc<Mutex<Vec<&'static str>>>,
        waits: Mutex<usize>,
    }

    impl CheckCadence for RecordingCadence {
        fn wait(&self, duration: Duration) -> bool {
            assert_eq!(duration, Duration::from_secs(6 * 60 * 60));
            self.events.lock().unwrap().push("wait");
            let mut waits = self.waits.lock().unwrap();
            *waits += 1;
            *waits == 1
        }
    }

    #[test]
    fn schedule_checks_at_startup_then_every_six_hours() {
        let events = Arc::new(Mutex::new(Vec::new()));
        let coordinator = UpdateCoordinator::new(
            Version::parse("0.1.0-alpha.1").unwrap(),
            FixedSource {
                result: Ok(None),
                events: Arc::clone(&events),
            },
            FixedPrompt {
                accept: false,
                shown: Arc::new(Mutex::new(Vec::new())),
            },
            RecordingAction::default(),
        );
        run_schedule(
            &coordinator,
            &RecordingCadence {
                events: Arc::clone(&events),
                waits: Mutex::new(0),
            },
            |_| {},
        );

        assert_eq!(
            &*events.lock().unwrap(),
            &["check", "wait", "check", "wait"]
        );
    }
}
