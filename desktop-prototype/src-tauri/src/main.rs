#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// Throwaway experiment: reuse the deployed web app and measure the entire process tree.
// The remote page receives no Tauri capabilities or Rust command access.
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::NewWindowResponse,
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

fn show_main(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn open_link(app: &tauri::AppHandle, url: &tauri::Url) {
    if matches!(url.scheme(), "https" | "http") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _| {
            if args.iter().any(|arg| arg == "--tray") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            } else {
                show_main(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let raw = std::env::var("VOICECHAT_DESKTOP_URL")
                .unwrap_or_else(|_| "http://localhost:3000".into());
            let url = tauri::Url::parse(&raw)?;
            let loopback = matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"));
            if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
                || !url.username().is_empty()
                || url.password().is_some()
            {
                return Err("Адрес сервера должен использовать HTTPS или локальный HTTP".into());
            }

            let origin = url.origin();
            let navigation_app = app.handle().clone();
            let popup_app = app.handle().clone();
            let window = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url))
                .title("Голосовой чат (прототип Tauri 2)")
                .visible(!std::env::args().any(|arg| arg == "--tray"))
                .inner_size(1180.0, 780.0)
                .min_inner_size(720.0, 480.0)
                .on_navigation(move |destination| {
                    if destination.origin() == origin {
                        true
                    } else {
                        open_link(&navigation_app, destination);
                        false
                    }
                })
                .on_new_window(move |destination, _| {
                    open_link(&popup_app, &destination);
                    NewWindowResponse::Deny
                })
                .build()?;

            let show = MenuItem::with_id(app, "show", "Открыть чат", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Свернуть в трей", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Выйти из приложения", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("bundled icon").clone())
                .tooltip("Голосовой чат: закрытие окна сворачивает в трей")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            // Install after tray creation: if setup fails, never strand a hidden window.
            let close_window = window.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    if close_window.hide().is_ok() {
                        api.prevent_close();
                    }
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("Не удалось запустить прототип голосового чата");
}
