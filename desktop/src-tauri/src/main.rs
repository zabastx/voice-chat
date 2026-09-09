#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod desktop_log;

// Keep the web release on the server and the operating-system shell in this binary.
// The remote page receives no Tauri capabilities or Rust command access.
use desktop_log::{DesktopEvent, DesktopLog};
use std::{
    net::{TcpStream, ToSocketAddrs},
    sync::{Arc, Condvar, Mutex},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

#[cfg(not(debug_assertions))]
const PRODUCTION_ORIGIN: &str = match option_env!("VOICECHAT_DESKTOP_PRODUCTION_ORIGIN") {
    Some(origin) => origin,
    None => "https://desktop-origin-not-configured.invalid",
};

fn valid_origin(url: &tauri::Url, allow_loopback_http: bool) -> bool {
    let loopback = matches!(
        url.host_str(),
        Some("localhost" | "127.0.0.1" | "::1" | "[::1]")
    );
    let valid_scheme =
        url.scheme() == "https" || (allow_loopback_http && url.scheme() == "http" && loopback);
    valid_scheme
        && !url.cannot_be_a_base()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/"
        && url.query().is_none()
        && url.fragment().is_none()
}

fn server_url() -> Result<tauri::Url, Box<dyn std::error::Error>> {
    #[cfg(debug_assertions)]
    let raw =
        std::env::var("VOICECHAT_DESKTOP_URL").unwrap_or_else(|_| "http://localhost:3000".into());
    #[cfg(not(debug_assertions))]
    let raw = PRODUCTION_ORIGIN.to_owned();

    let url = tauri::Url::parse(&raw)?;
    if !valid_origin(&url, cfg!(debug_assertions)) {
        return Err(
            "Адрес Voice Chat должен быть HTTPS origin; debug также разрешает loopback HTTP".into(),
        );
    }
    Ok(url)
}

#[cfg(test)]
mod origin_tests {
    use super::valid_origin;

    fn url(value: &str) -> tauri::Url {
        tauri::Url::parse(value).expect("valid test URL")
    }

    #[test]
    fn release_accepts_only_a_root_https_origin() {
        assert!(valid_origin(&url("https://chat.example.com"), false));
        assert!(!valid_origin(&url("http://chat.example.com"), false));
        assert!(!valid_origin(&url("https://chat.example.com/path"), false));
        assert!(!valid_origin(
            &url("https://member:secret@chat.example.com"),
            false
        ));
    }

    #[test]
    fn debug_additionally_accepts_loopback_http() {
        assert!(valid_origin(&url("http://localhost:3000"), true));
        assert!(valid_origin(&url("http://127.0.0.1:3000"), true));
        assert!(valid_origin(&url("http://[::1]:3000"), true));
        assert!(!valid_origin(&url("http://chat.example.com"), true));
    }
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

fn server_reachable(url: &tauri::Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let Some(port) = url.port_or_known_default() else {
        return false;
    };
    let Ok(addresses) = (host, port).to_socket_addrs() else {
        return false;
    };
    addresses
        .into_iter()
        .any(|address| TcpStream::connect_timeout(&address, Duration::from_secs(2)).is_ok())
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

fn start_reconnect_worker(app: tauri::AppHandle, target: tauri::Url, signal: ReconnectSignal) {
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

        if server_reachable(&target) {
            record(&app, DesktopEvent::ServerReached);
            let navigate_app = app.clone();
            let navigate_target = target.clone();
            let _ = app.run_on_main_thread(move || {
                if let Some(window) = navigate_app.get_webview_window("main") {
                    let _ = window.navigate(navigate_target);
                }
            });
            return;
        }
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            perform_action(app, action_from_args(&args));
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let log = DesktopLog::new(app.path().app_log_dir()?)?;
            app.manage(log);
            record(app.handle(), DesktopEvent::Started);
            let url = server_url()?;

            let origin = url.origin();
            let navigation_origin = origin.clone();
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let reconnect = ReconnectSignal::default();
            let navigation_reconnect = reconnect.clone();
            let initial_reachable = server_reachable(&url);
            let initial_url = if initial_reachable {
                WebviewUrl::External(url.clone())
            } else {
                WebviewUrl::App("index.html".into())
            };
            let window = WebviewWindowBuilder::new(app, "main", initial_url)
                .title("Voice Chat")
                .visible(!std::env::args().any(|arg| arg == "--tray"))
                .inner_size(1180.0, 780.0)
                .min_inner_size(720.0, 480.0)
                .on_navigation(move |destination| {
                    match (destination.scheme(), destination.host_str()) {
                        ("voicechat", Some("retry")) => navigation_reconnect.request(),
                        ("voicechat", Some("exit")) => {
                            perform_action(&navigation_app, ShellAction::Exit)
                        }
                        _ if destination.origin() == navigation_origin => return true,
                        ("tauri", Some("localhost")) | ("http", Some("tauri.localhost")) => {
                            return true;
                        }
                        _ => open_link(&navigation_app, destination),
                    }
                    false
                })
                .on_new_window(move |destination, _| {
                    open_link(&popup_app, &destination);
                    NewWindowResponse::Deny
                })
                .build()?;

            if !initial_reachable {
                record(app.handle(), DesktopEvent::WaitingForServer);
                start_reconnect_worker(app.handle().clone(), url, reconnect);
            }

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
        .run(tauri::generate_context!())
        .expect("Не удалось запустить Voice Chat");
}
