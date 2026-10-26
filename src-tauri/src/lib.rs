mod files;
mod media;
mod net;
mod secrets;
mod state;

use std::fs;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition};

use state::AppState;

fn toggle_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        } else {
            let _ = window.show();
        }
    }
}

/// Show the overlay (it may be hidden from the tray) and tell the page what the user picked.
fn tell_page(app: &AppHandle, action: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
    }
    let _ = app.emit("tray", action);
}

/// Park the overlay at the top centre of the primary monitor, like a notch.
fn place_at_top_centre(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let (Ok(Some(monitor)), Ok(size)) = (window.primary_monitor(), window.outer_size()) else {
        return;
    };
    let x = monitor.position().x + (monitor.size().width as i32 - size.width as i32) / 2;
    let y = monitor.position().y;
    let _ = window.set_position(PhysicalPosition::new(x, y));
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            for sub in ["pips", "avatars"] {
                fs::create_dir_all(config_dir.join(sub))?;
            }
            app.manage(AppState::new(config_dir)?);

            place_at_top_centre(app.handle());

            let toggle = MenuItem::with_id(app, "toggle", "Show / hide Perch", true, None::<&str>)?;
            let library = MenuItem::with_id(app, "library", "Open Library", true, None::<&str>)?;
            let centre = MenuItem::with_id(app, "centre", "Centre on this screen", true, None::<&str>)?;
            let folder = MenuItem::with_id(app, "folder", "Open config folder", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit Perch", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&toggle, &library, &centre, &folder, &quit])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or("missing app icon")?)
                .tooltip("Perch")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "toggle" => toggle_main_window(app),
                    "library" | "centre" => tell_page(app, event.id.as_ref()),
                    "folder" => {
                        let state = app.state::<AppState>();
                        let _ = files::open_config_dir(state);
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
                        toggle_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            media::media_get_state,
            media::media_get_thumbnail,
            media::media_control,
            net::fetch_json,
            net::open_url,
            net::approved_hosts,
            net::approve_host,
            net::revoke_host,
            secrets::secret_set,
            secrets::secret_exists,
            secrets::secret_delete,
            files::list_user_files,
            files::save_user_file,
            files::open_config_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Perch");
}
