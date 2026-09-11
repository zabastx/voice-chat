#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod desktop_log;
#[path = "../origin.rs"]
mod origin;
mod update;

// Keep the web release on the server and the operating-system shell in this binary.
// The remote page receives no Tauri capabilities or Rust command access.
use desktop_log::{DesktopEvent, DesktopLog};
use std::{
    sync::{
        atomic::{AtomicU64, AtomicU8, Ordering},
        Arc, Condvar, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
    Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;
#[cfg(windows)]
use webview2_com::{
    CoTaskMemPWSTR, Microsoft::Web::WebView2::Win32::ICoreWebView2NavigationCompletedEventArgs2,
    NavigationCompletedEventHandler, NavigationStartingEventHandler,
};
#[cfg(windows)]
use windows::core::{Interface, BOOL, PWSTR};

#[cfg(not(debug_assertions))]
const PRODUCTION_ORIGIN: &str = match option_env!("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN") {
    Some(origin) => origin,
    None => "https://desktop-origin-not-configured.invalid",
};

fn server_url() -> Result<tauri::Url, Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    let raw =
        std::env::var("VOICECHAT_DESKTOP_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    #[cfg(not(debug_assertions))]
    let raw = PRODUCTION_ORIGIN.to_owned();

    let url = tauri::Url::parse(&raw)?;
    let allow_loopback_http =
        cfg!(debug_assertions) || option_env!("VOICECHAT_DESKTOP_UPDATE_CHECK") == Some("1");
    if !origin::valid_origin(&url, allow_loopback_http) {
        return Err(
            "Адрес Voice Chat должен быть HTTPS origin; debug также разрешает loopback HTTP".into(),
        );
    }
    Ok(url)
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[derive(Clone, Copy)]
enum ShellAction {
    Show,
    Hide,
    OpenLogs,
    Exit,
}

fn action_from_args(args: &[String]) -> ShellAction {
    if args.iter().any(|arg| arg == "--exit") {
        ShellAction::Exit
    } else if args.iter().any(|arg| arg == "--logs") {
        ShellAction::OpenLogs
    } else if args.iter().any(|arg| arg == "--tray") {
        ShellAction::Hide
    } else {
        ShellAction::Show
    }
}

fn should_exit_on_startup(args: &[String]) -> bool {
    matches!(action_from_args(args), ShellAction::Exit)
}

fn perform_action(app: &tauri::AppHandle, action: ShellAction) {
    match action {
        ShellAction::Show => {
            show_main(app);
            record(app, DesktopEvent::WindowShown);
        }
        ShellAction::Hide => {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.hide();
            }
            record(app, DesktopEvent::WindowHidden);
        }
        ShellAction::OpenLogs => {
            if let Ok(directory) = app.path().app_log_dir() {
                let _ = app
                    .opener()
                    .open_path(directory.to_string_lossy(), None::<&str>);
                record(app, DesktopEvent::LogsOpened);
            }
        }
        ShellAction::Exit => {
            record(app, DesktopEvent::ExitRequested);
            app.exit(0);
        }
    }
}

fn record(app: &tauri::AppHandle, event: DesktopEvent) {
    if let Some(log) = app.try_state::<DesktopLog>() {
        log.event(event);
    }
}

fn open_link(app: &tauri::AppHandle, url: &tauri::Url) {
    if matches!(url.scheme(), "https" | "http") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
        record(app, DesktopEvent::ExternalNavigation);
    }
}

const OFFLINE: u8 = 0;
const CONNECTING: u8 = 1;
const ONLINE: u8 = 2;
const LOCAL_ERROR_URL: &str = "http://tauri.localhost/index.html";

#[derive(Default)]
struct ConnectionState {
    mode: AtomicU8,
    attempt: AtomicU64,
}

impl ConnectionState {
    fn begin(&self) -> u64 {
        self.mode.store(CONNECTING, Ordering::SeqCst);
        self.attempt.fetch_add(1, Ordering::SeqCst) + 1
    }

    fn online(&self) {
        self.mode.store(ONLINE, Ordering::SeqCst);
        self.attempt.fetch_add(1, Ordering::SeqCst);
    }

    fn offline(&self) -> bool {
        let previous = self.mode.swap(OFFLINE, Ordering::SeqCst);
        self.attempt.fetch_add(1, Ordering::SeqCst);
        previous != OFFLINE
    }

    fn is_current_attempt(&self, attempt: u64) -> bool {
        self.mode.load(Ordering::SeqCst) == CONNECTING
            && self.attempt.load(Ordering::SeqCst) == attempt
    }

    fn is_offline(&self) -> bool {
        self.mode.load(Ordering::SeqCst) == OFFLINE
    }

    fn allows_local_page(&self) -> bool {
        self.mode.load(Ordering::SeqCst) == OFFLINE
    }
}

fn show_offline(app: &tauri::AppHandle, connection: &Arc<ConnectionState>) {
    if connection.offline() {
        record(app, DesktopEvent::WaitingForServer);
    }
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(50));
        let fallback_app = window.app_handle().clone();
        let _ = fallback_app.run_on_main_thread(move || {
            let _ = window.with_webview(move |platform| unsafe {
                if let Ok(webview) = platform.controller().CoreWebView2() {
                    let url = CoTaskMemPWSTR::from(LOCAL_ERROR_URL);
                    let _ = webview.Stop();
                    let _ = webview.Navigate(*url.as_ref().as_pcwstr());
                }
            });
        });
    });
}

fn fallback_commands_allowed(
    connection: &ConnectionState,
    current_url: Option<&tauri::Url>,
) -> bool {
    connection.is_offline() && current_url.is_some_and(|url| url.as_str() == LOCAL_ERROR_URL)
}

fn is_local_fallback(app: &tauri::AppHandle, connection: &ConnectionState) -> bool {
    let current_url = app
        .get_webview_window("main")
        .and_then(|window| window.url().ok());
    fallback_commands_allowed(connection, current_url.as_ref())
}

#[cfg(test)]
mod navigation_tests {
    use super::{
        fallback_commands_allowed, should_exit_on_startup, ConnectionState, LOCAL_ERROR_URL,
    };

    #[test]
    fn exit_argument_stops_a_primary_launch_before_it_builds_the_window() {
        assert!(should_exit_on_startup(&[
            "voice-chat.exe".into(),
            "--exit".into(),
        ]));
        assert!(!should_exit_on_startup(&["voice-chat.exe".into()]));
    }

    #[test]
    fn remote_document_cannot_use_fallback_commands_during_offline_transition() {
        let connection = ConnectionState::default();
        let remote = tauri::Url::parse("https://chat.example.com/").unwrap();
        let fallback = tauri::Url::parse(LOCAL_ERROR_URL).unwrap();

        assert!(!fallback_commands_allowed(&connection, Some(&remote)));
        assert!(fallback_commands_allowed(&connection, Some(&fallback)));
    }
}

fn navigate_to_server(
    app: &tauri::AppHandle,
    target: &tauri::Url,
    connection: &Arc<ConnectionState>,
) {
    let Some(window) = app.get_webview_window("main") else {
        show_offline(app, connection);
        return;
    };
    if window.navigate(target.clone()).is_err() {
        show_offline(app, connection);
    }
}

#[derive(Clone, Default)]
struct ReconnectSignal(Arc<(Mutex<bool>, Condvar)>);

impl ReconnectSignal {
    fn request(&self) {
        let (pending, wake) = &*self.0;
        if let Ok(mut pending) = pending.lock() {
            *pending = true;
            wake.notify_one();
        }
    }
}

fn start_reconnect_worker(
    app: tauri::AppHandle,
    target: tauri::Url,
    signal: ReconnectSignal,
    connection: Arc<ConnectionState>,
) {
    std::thread::spawn(move || loop {
        let (pending, wake) = &*signal.0;
        let Ok(pending) = pending.lock() else {
            return;
        };
        let Ok((mut pending, _)) =
            wake.wait_timeout_while(pending, Duration::from_secs(30), |pending| !*pending)
        else {
            return;
        };
        *pending = false;
        drop(pending);

        if connection.is_offline() {
            let navigate_app = app.clone();
            let navigate_target = target.clone();
            let navigate_connection = Arc::clone(&connection);
            let _ = app.run_on_main_thread(move || {
                navigate_to_server(&navigate_app, &navigate_target, &navigate_connection);
            });
        }
    });
}

fn health_check_script(origin: &tauri::Url) -> String {
    let origin = origin.origin().ascii_serialization();
    format!(
        r#"(() => {{
            const expectedOrigin = {origin:?};
            const nativeFetch = globalThis.fetch.bind(globalThis);
            const nativeSetInterval = globalThis.setInterval.bind(globalThis);
            nativeSetInterval(async () => {{
                if (location.origin !== expectedOrigin) return;
                try {{
                    const response = await nativeFetch(expectedOrigin, {{
                        method: 'HEAD', cache: 'no-store', credentials: 'omit', redirect: 'manual'
                    }});
                    if (response.status >= 500) {{
                        location.replace(`${{expectedOrigin}}/?desktop-recovery=${{Date.now()}}`);
                    }}
                }} catch {{
                    location.replace(`${{expectedOrigin}}/?desktop-recovery=${{Date.now()}}`);
                }}
            }}, 30000);
        }})();"#
    )
}

#[cfg(windows)]
fn watch_navigation(
    window: &tauri::WebviewWindow,
    target_origin: url::Origin,
    connection: Arc<ConnectionState>,
) -> tauri::Result<()> {
    let target_navigation = Arc::new(AtomicU64::new(0));
    let starting_window = window.clone();
    let starting_origin = target_origin.clone();
    let starting_navigation = Arc::clone(&target_navigation);
    let starting_connection = Arc::clone(&connection);
    let callback_window = window.clone();
    window.with_webview(move |platform| {
        let controller = platform.controller();
        let starting_handler =
            NavigationStartingEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let mut uri = PWSTR::null();
                let mut navigation_id = 0;
                unsafe {
                    args.Uri(&mut uri)?;
                    args.NavigationId(&mut navigation_id)?;
                }
                let uri = CoTaskMemPWSTR::from(uri).to_string();
                let targets_server = url::Url::parse(&uri)
                    .map(|url| url.origin() == starting_origin)
                    .unwrap_or(false);
                if !targets_server {
                    return Ok(());
                }

                starting_navigation.store(navigation_id, Ordering::SeqCst);
                let attempt = starting_connection.begin();
                let timeout_window = starting_window.clone();
                let timeout_connection = Arc::clone(&starting_connection);
                std::thread::spawn(move || {
                    std::thread::sleep(Duration::from_secs(10));
                    if timeout_connection.is_current_attempt(attempt) {
                        let timeout_app = timeout_window.app_handle().clone();
                        let fallback_app = timeout_app.clone();
                        let _ = timeout_app.run_on_main_thread(move || {
                            show_offline(&fallback_app, &timeout_connection);
                        });
                    }
                });
                Ok(())
            }));

        let callback_connection = Arc::clone(&connection);
        let callback_navigation = Arc::clone(&target_navigation);
        let handler = NavigationCompletedEventHandler::create(Box::new(move |sender, args| {
            let (Some(sender), Some(args)) = (sender, args) else {
                return Ok(());
            };
            let mut source = PWSTR::null();
            let mut success = BOOL::default();
            let mut navigation_id = 0;
            unsafe {
                sender.Source(&mut source)?;
                args.IsSuccess(&mut success)?;
                args.NavigationId(&mut navigation_id)?;
            }

            let source = CoTaskMemPWSTR::from(source).to_string();
            let source_matches = url::Url::parse(&source)
                .map(|url| url.origin() == target_origin)
                .unwrap_or(false);
            let mut status = 0;
            if let Ok(args2) = args.cast::<ICoreWebView2NavigationCompletedEventArgs2>() {
                unsafe { args2.HttpStatusCode(&mut status)? };
            }

            if callback_navigation.load(Ordering::SeqCst) != navigation_id {
                return Ok(());
            }

            if source_matches && success.as_bool() && status < 400 {
                callback_connection.online();
                record(callback_window.app_handle(), DesktopEvent::ServerReached);
            } else if callback_connection.mode.load(Ordering::SeqCst) == CONNECTING
                && (!success.as_bool() || status >= 400)
            {
                show_offline(callback_window.app_handle(), &callback_connection);
            }
            Ok(())
        }));
        let mut starting_token = 0;
        let mut completed_token = 0;
        unsafe {
            if let Ok(webview) = controller.CoreWebView2() {
                let _ = webview.add_NavigationStarting(&starting_handler, &mut starting_token);
                let _ = webview.add_NavigationCompleted(&handler, &mut completed_token);
            }
        }
    })
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            perform_action(app, action_from_args(&args));
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let log = DesktopLog::new(app.path().app_log_dir()?)?;
            app.manage(log);
            record(app.handle(), DesktopEvent::Started);
            let startup_args = std::env::args().collect::<Vec<_>>();
            if should_exit_on_startup(&startup_args) {
                perform_action(app.handle(), ShellAction::Exit);
                return Ok(());
            }
            let url = server_url()?;

            let origin = url.origin();
            let navigation_origin = origin.clone();
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let reconnect = ReconnectSignal::default();
            let navigation_reconnect = reconnect.clone();
            let connection = Arc::new(ConnectionState::default());
            let navigation_connection = Arc::clone(&connection);
            let bridge = Arc::new(bridge::Bridge::default());
            let navigation_bridge = Arc::clone(&bridge);
            let window =
                WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Voice Chat")
                    .visible(!std::env::args().any(|arg| arg == "--tray"))
                    .inner_size(1180.0, 780.0)
                    .min_inner_size(720.0, 480.0)
                    .initialization_script(health_check_script(&url))
                    .initialization_script(bridge.script(&url))
                    .on_navigation(move |destination| {
                        let loads_document = match (destination.scheme(), destination.host_str()) {
                            // The remote page's only reach into the shell: a cancelled
                            // navigation carrying one named, validated operation.
                            ("voicechat", Some("bridge"))
                                if bridge::is_trusted_document(
                                    &navigation_app,
                                    &navigation_origin,
                                ) =>
                            {
                                navigation_bridge.handle(&navigation_app, destination);
                                false
                            }
                            ("voicechat", Some("retry"))
                                if is_local_fallback(&navigation_app, &navigation_connection) =>
                            {
                                navigation_reconnect.request();
                                false
                            }
                            ("voicechat", Some("exit"))
                                if is_local_fallback(&navigation_app, &navigation_connection) =>
                            {
                                perform_action(&navigation_app, ShellAction::Exit);
                                false
                            }
                            _ if destination.origin() == navigation_origin => true,
                            ("tauri", Some("localhost")) | ("http", Some("tauri.localhost"))
                                if navigation_connection.allows_local_page() =>
                            {
                                true
                            }
                            _ => {
                                open_link(&navigation_app, destination);
                                false
                            }
                        };
                        // Whatever the outgoing document reported about a live call goes
                        // with it, so only a navigation we actually let through clears it.
                        if loads_document {
                            navigation_bridge.clear_voice(&navigation_app);
                        }
                        loads_document
                    })
                    .on_new_window(move |destination, _| {
                        open_link(&popup_app, &destination);
                        NewWindowResponse::Deny
                    })
                    .build()?;

            watch_navigation(&window, origin, Arc::clone(&connection))?;
            // Kept for the updater ticket: an agreed update waits for the call to end.
            app.manage(bridge);
            start_reconnect_worker(
                app.handle().clone(),
                url,
                reconnect.clone(),
                Arc::clone(&connection),
            );
            reconnect.request();

            let show = MenuItem::with_id(app, "show", "Открыть чат", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Свернуть в трей", true, None::<&str>)?;
            let logs = MenuItem::with_id(app, "logs", "Открыть папку логов", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выйти из приложения", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &logs, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .tooltip("Voice Chat: закрытие окна сворачивает в трей")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => perform_action(app, ShellAction::Show),
                    "hide" => perform_action(app, ShellAction::Hide),
                    "logs" => perform_action(app, ShellAction::OpenLogs),
                    "quit" => perform_action(app, ShellAction::Exit),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        perform_action(tray.app_handle(), ShellAction::Show);
                    }
                })
                .build(app)?;

            // Install after tray creation: if setup fails, never strand a hidden window.
            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if close_window.hide().is_ok() {
                        record(close_window.app_handle(), DesktopEvent::WindowHidden);
                        api.prevent_close();
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("Не удалось запустить Voice Chat");
    app.run(|app, event| {
        if matches!(event, RunEvent::Ready)
            && !should_exit_on_startup(&std::env::args().collect::<Vec<_>>())
        {
            if let Ok(url) = server_url() {
                update::start_portable(app.clone(), &url);
            }
        }
    });
}
