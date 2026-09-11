use semver::Version;
use std::{
    cmp::Ordering,
    sync::{
        atomic::{AtomicBool, Ordering as AtomicOrdering},
        Arc,
    },
    time::Duration,
};
use tauri::Manager;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::{desktop_log::DesktopEvent, record};

const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const VOICE_POLL: Duration = Duration::from_secs(5);
// shorter than CHECK_INTERVAL on purpose: a page that never clears the flag must end up
// re-asking the member at the next check, not pin the coordinator for good
const MAX_DEFERRAL: Duration = Duration::from_secs(4 * 60 * 60);

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

/// Whether the remote page currently reports a live Voice Channel. This is the one
/// reverse operation of the Native Bridge (ADR 0013), read here and nowhere else.
trait VoiceChannel {
    fn is_active(&self) -> bool;
}

/// Sleeping, as a seam: the deferral is measured in hours, which no test can wait out.
trait Pause {
    fn pause(&self, duration: Duration);
}

trait InstallUpdate {
    fn install(&self) -> Result<(), String>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum CheckResult {
    Busy,
    NoUpdate,
    Postponed,
    Applied,
    /// the feed could not be read — nothing was offered to the member
    CheckFailed,
    /// the member agreed and the shell could not carry it out
    ActionFailed,
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
            Err(_) => return CheckResult::CheckFailed,
        };
        if offer.version.cmp_precedence(&self.current_version) != Ordering::Greater {
            return CheckResult::NoUpdate;
        }
        if !self.prompt.accept(&offer) {
            return CheckResult::Postponed;
        }
        match self.action.apply(&offer) {
            Ok(()) => CheckResult::Applied,
            Err(_) => CheckResult::ActionFailed,
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

/// Both forms say the same thing about the Release and differ only in what they ask for.
fn offer_message(offer: &UpdateOffer, question: &str) -> String {
    let head = format!("Доступна новая версия Voice Chat {}.", offer.version);
    let notes = offer.notes.trim();
    if notes.is_empty() {
        format!("{head}\n\n{question}")
    } else {
        format!("{head}\n\n{notes}\n\n{question}")
    }
}

fn ask(app: &tauri::AppHandle, message: String, accept: &str) -> bool {
    app.dialog()
        .message(message)
        .title("Обновление Voice Chat")
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            accept.to_owned(),
            "Отложить".into(),
        ))
        .blocking_show()
}

struct PortablePrompt(tauri::AppHandle);

impl UpdatePrompt for PortablePrompt {
    fn accept(&self, offer: &UpdateOffer) -> bool {
        let message = offer_message(
            offer,
            "Открыть страницу выпуска, чтобы скачать и вручную заменить Portable EXE?",
        );
        ask(&self.0, message, "Открыть выпуск")
    }
}

/// The installed client asks for something else: it replaces itself and comes back, and
/// it will not do that in the middle of a call.
struct InstalledPrompt(tauri::AppHandle);

impl UpdatePrompt for InstalledPrompt {
    fn accept(&self, offer: &UpdateOffer) -> bool {
        let message = offer_message(
            offer,
            "Установить обновление? Клиент перезапустится, а если идёт разговор в голосовом канале, установка дождётся его окончания.",
        );
        ask(&self.0, message, "Установить")
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

/// Blocks while the member is in a Voice Channel, so an agreed update installs after the
/// call instead of cutting its RTP. It gives up before the next scheduled check: a page
/// that never clears the flag must end up asking again, not holding the coordinator.
fn wait_for_quiet_voice(
    voice: &impl VoiceChannel,
    pause: &impl Pause,
    on_wait: impl FnOnce(),
) -> Result<(), String> {
    if !voice.is_active() {
        return Ok(());
    }
    on_wait();
    let mut waited = Duration::ZERO;
    while voice.is_active() {
        if waited >= MAX_DEFERRAL {
            return Err("Voice Channel is still live".to_owned());
        }
        pause.pause(VOICE_POLL);
        waited += VOICE_POLL;
    }
    Ok(())
}

struct BridgeVoice(tauri::AppHandle);

impl VoiceChannel for BridgeVoice {
    fn is_active(&self) -> bool {
        self.0
            .try_state::<Arc<crate::bridge::Bridge>>()
            .is_some_and(|bridge| bridge.voice_active())
    }
}

struct SleepPause;

impl Pause for SleepPause {
    fn pause(&self, duration: Duration) {
        std::thread::sleep(duration);
    }
}

struct PluginInstall {
    app: tauri::AppHandle,
    endpoint: Url,
}

impl InstallUpdate for PluginInstall {
    fn install(&self) -> Result<(), String> {
        // The plugin reads the same feed again and accepts the artifact only if its
        // signature matches the public key baked into this build. Nothing else in the
        // shell installs anything, and the remote page cannot reach this at all.
        let updater = self
            .app
            .updater_builder()
            .endpoints(vec![self.endpoint.clone()])
            .map_err(|error| error.to_string())?
            .build()
            .map_err(|error| error.to_string())?;
        let update = tauri::async_runtime::block_on(updater.check())
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "The updater found nothing to install".to_owned())?;
        record(&self.app, DesktopEvent::UpdateInstallStarted);
        // on Windows this hands the signed installer /P /R and exits the process, so a
        // successful install never returns here — the next proof is the restarted client
        tauri::async_runtime::block_on(update.download_and_install(|_, _| {}, || {}))
            .map_err(|error| error.to_string())
    }
}

struct DeferredInstall<V, P, I> {
    voice: V,
    pause: P,
    installer: I,
    on_wait: Box<dyn Fn() + Send + Sync>,
}

impl<V, P, I> UpdateAction for DeferredInstall<V, P, I>
where
    V: VoiceChannel,
    P: Pause,
    I: InstallUpdate,
{
    fn apply(&self, _offer: &UpdateOffer) -> Result<(), String> {
        wait_for_quiet_voice(&self.voice, &self.pause, || (self.on_wait)())?;
        self.installer.install()
    }
}

struct SixHourCadence;

impl CheckCadence for SixHourCadence {
    fn wait(&self, duration: Duration) -> bool {
        std::thread::sleep(duration);
        true
    }
}

/// What a finished check leaves in the local log. Both forms share the coordinator but
/// not the outcome: one opened a page, the other replaced the client.
#[derive(Clone, Copy)]
struct ResultEvents {
    applied: DesktopEvent,
    action_failed: DesktopEvent,
}

const PORTABLE_EVENTS: ResultEvents = ResultEvents {
    applied: DesktopEvent::UpdateReleaseOpened,
    action_failed: DesktopEvent::UpdateReleaseFailed,
};

const INSTALLED_EVENTS: ResultEvents = ResultEvents {
    applied: DesktopEvent::UpdateInstalled,
    action_failed: DesktopEvent::UpdateInstallFailed,
};

fn record_result(app: &tauri::AppHandle, result: CheckResult, events: ResultEvents) {
    let event = match result {
        CheckResult::CheckFailed => Some(DesktopEvent::UpdateCheckFailed),
        CheckResult::ActionFailed => Some(events.action_failed),
        CheckResult::Postponed => Some(DesktopEvent::UpdatePostponed),
        CheckResult::Applied => Some(events.applied),
        CheckResult::Busy | CheckResult::NoUpdate => None,
    };
    if let Some(event) = event {
        record(app, event);
    }
}

/// The feed this build talks to, and the version it is talking about. The version comes
/// from the Tauri package info, which is what the bundle and its artifacts carry.
fn source_and_version(app: &tauri::AppHandle, origin: &Url) -> Option<(HttpUpdateSource, Version)> {
    match HttpUpdateSource::new(origin) {
        Ok(source) => Some((source, app.package_info().version.clone())),
        Err(_) => {
            record(app, DesktopEvent::UpdateCheckFailed);
            None
        }
    }
}

fn spawn_schedule<S, P, A>(
    app: tauri::AppHandle,
    coordinator: UpdateCoordinator<S, P, A>,
    events: ResultEvents,
) where
    S: UpdateSource + Send + 'static,
    P: UpdatePrompt + Send + 'static,
    A: UpdateAction + Send + 'static,
{
    std::thread::spawn(move || {
        run_schedule(&coordinator, &SixHourCadence, |result| {
            record_result(&app, result, events)
        });
    });
}

/// Starts the update stream this build belongs to. A build that was never stamped is a
/// development build — neither form — and offers the member nothing.
pub fn start(app: tauri::AppHandle, origin: &Url) {
    match option_env!("VOICECHAT_DESKTOP_MODE") {
        Some("portable") => start_portable(app, origin),
        Some("installed") => start_installed(app, origin),
        _ => {}
    }
}

fn start_portable(app: tauri::AppHandle, origin: &Url) {
    let Some((source, current_version)) = source_and_version(&app, origin) else {
        return;
    };
    let coordinator = UpdateCoordinator::new(
        current_version,
        source,
        PortablePrompt(app.clone()),
        OpenPortableRelease(app.clone()),
    );
    spawn_schedule(app, coordinator, PORTABLE_EVENTS);
}

fn start_installed(app: tauri::AppHandle, origin: &Url) {
    let Some((source, current_version)) = source_and_version(&app, origin) else {
        return;
    };
    let Ok(mut endpoint) = origin.join("/api/desktop/update") else {
        record(&app, DesktopEvent::UpdateCheckFailed);
        return;
    };
    // the plugin fills these in from its own build target and package version
    endpoint.set_query(Some(
        "target={{target}}&arch={{arch}}&version={{current_version}}",
    ));
    let waiting = app.clone();
    let coordinator = UpdateCoordinator::new(
        current_version,
        source,
        InstalledPrompt(app.clone()),
        DeferredInstall {
            voice: BridgeVoice(app.clone()),
            pause: SleepPause,
            installer: PluginInstall {
                app: app.clone(),
                endpoint,
            },
            on_wait: Box::new(move || record(&waiting, DesktopEvent::UpdateWaitingForCall)),
        },
    );
    spawn_schedule(app, coordinator, INSTALLED_EVENTS);
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
    fn the_offer_reads_as_one_paragraph_per_thing_it_says() {
        let offered = offer("0.1.0-alpha.2");
        assert_eq!(
            offer_message(&offered, "Установить обновление?"),
            "Доступна новая версия Voice Chat 0.1.0-alpha.2.\n\nИсправлена доставка обновлений.\n\nУстановить обновление?"
        );

        let mut silent = offered.clone();
        silent.notes = "   ".to_owned();
        assert_eq!(
            offer_message(&silent, "Установить обновление?"),
            "Доступна новая версия Voice Chat 0.1.0-alpha.2.\n\nУстановить обновление?"
        );
    }

    struct FixedVoice(Mutex<Vec<bool>>);

    impl VoiceChannel for FixedVoice {
        fn is_active(&self) -> bool {
            let mut answers = self.0.lock().unwrap();
            if answers.len() == 1 {
                answers[0]
            } else {
                answers.remove(0)
            }
        }
    }

    #[derive(Default)]
    struct CountingPause(Mutex<Duration>);

    impl Pause for CountingPause {
        fn pause(&self, duration: Duration) {
            *self.0.lock().unwrap() += duration;
        }
    }

    #[derive(Default)]
    struct RecordingInstall(Mutex<usize>);

    impl InstallUpdate for RecordingInstall {
        fn install(&self) -> Result<(), String> {
            *self.0.lock().unwrap() += 1;
            Ok(())
        }
    }

    fn deferred(
        voice: Vec<bool>,
    ) -> (
        DeferredInstall<FixedVoice, CountingPause, RecordingInstall>,
        Arc<Mutex<usize>>,
    ) {
        let waits = Arc::new(Mutex::new(0));
        let counted = Arc::clone(&waits);
        (
            DeferredInstall {
                voice: FixedVoice(Mutex::new(voice)),
                pause: CountingPause::default(),
                installer: RecordingInstall::default(),
                on_wait: Box::new(move || *counted.lock().unwrap() += 1),
            },
            waits,
        )
    }

    #[test]
    fn an_agreed_install_waits_for_the_voice_channel_to_end() {
        let (action, waits) = deferred(vec![true, true, true, false]);

        assert_eq!(action.apply(&offer("0.1.0-alpha.2")), Ok(()));
        assert_eq!(*action.installer.0.lock().unwrap(), 1);
        // one log line per deferral, however long the call runs
        assert_eq!(*waits.lock().unwrap(), 1);
        assert_eq!(*action.pause.0.lock().unwrap(), VOICE_POLL * 2);
    }

    #[test]
    fn an_install_outside_a_call_does_not_wait_at_all() {
        let (action, waits) = deferred(vec![false]);

        assert_eq!(action.apply(&offer("0.1.0-alpha.2")), Ok(()));
        assert_eq!(*action.installer.0.lock().unwrap(), 1);
        assert_eq!(*waits.lock().unwrap(), 0);
        assert_eq!(*action.pause.0.lock().unwrap(), Duration::ZERO);
    }

    #[test]
    fn a_call_that_never_ends_gives_the_update_back_to_the_next_check() {
        let (action, waits) = deferred(vec![true]);

        assert!(action.apply(&offer("0.1.0-alpha.2")).is_err());
        // nothing was downloaded or installed behind the member's back
        assert_eq!(*action.installer.0.lock().unwrap(), 0);
        assert_eq!(*waits.lock().unwrap(), 1);
        assert!(*action.pause.0.lock().unwrap() < CHECK_INTERVAL);
    }

    #[test]
    fn feed_failure_stays_a_diagnostic_and_does_not_block_the_app() {
        let (coordinator, shown) = coordinator(Err("feed unavailable".into()), true);

        assert_eq!(coordinator.check_now(), CheckResult::CheckFailed);
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
