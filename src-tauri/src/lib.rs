pub mod git;
pub mod github;
pub mod lfs_agent;
pub mod locks;
pub mod project;
pub mod s3;
pub mod settings;
pub mod state;
pub mod storage;
pub mod sync;
pub mod watcher;

use serde::{Deserialize, Serialize};
use settings::{Account, Project, Settings};
use state::{blocking, AppState, Res};
use std::path::PathBuf;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, WindowEvent};
use tauri_plugin_notification::NotificationExt;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppSnapshot {
    account: Option<Account>,
    projects: Vec<Project>,
    active_project: Option<Project>,
    auto_lock: bool,
    close_to_tray: bool,
    github_client_id: Option<String>,
    git_version: String,
    bundled_git: bool,
}

#[tauri::command]
async fn get_app_state(app: AppHandle) -> Res<AppSnapshot> {
    blocking(move || {
        let st = app.state::<AppState>();
        let s = st.settings();
        let git = st.git();
        Ok(AppSnapshot {
            active_project: s.active().cloned(),
            account: s.account.clone(),
            projects: s.projects.clone(),
            auto_lock: s.auto_lock,
            close_to_tray: s.close_to_tray,
            github_client_id: s.github_client_id(),
            git_version: git.version().unwrap_or_else(|e| format!("FEHLT: {e}")),
            bundled_git: git.exe.is_absolute(),
        })
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SettingsPatch {
    auto_lock: Option<bool>,
    close_to_tray: Option<bool>,
    github_client_id: Option<String>,
}

#[tauri::command]
async fn update_settings(app: AppHandle, patch: SettingsPatch) -> Res<()> {
    app.state::<AppState>().update_settings(|s| {
        if let Some(v) = patch.auto_lock {
            s.auto_lock = v;
        }
        if let Some(v) = patch.close_to_tray {
            s.close_to_tray = v;
        }
        if let Some(v) = patch.github_client_id {
            s.github_client_id = Some(v.trim().to_string()).filter(|v| !v.is_empty());
        }
    })?;
    Ok(())
}

/// Wechselt das aktive Projekt. Liefert `true`, wenn ein Zugangscode fehlt.
#[tauri::command]
async fn select_project(app: AppHandle, path: String) -> Res<bool> {
    blocking(move || {
        let st = app.state::<AppState>();
        st.update_settings(|s| {
            if s.projects.iter().any(|p| p.path == path) {
                s.active_project = Some(path.clone());
            }
        })?;
        let needs = project::ensure_storage(&st.git(), &PathBuf::from(&path))?;
        watcher::restart(&app);
        Ok(needs)
    })
    .await
}

#[tauri::command]
async fn remove_project(app: AppHandle, path: String) -> Res<()> {
    let st = app.state::<AppState>();
    st.update_settings(|s| {
        s.projects.retain(|p| p.path != path);
        if s.active_project.as_deref() == Some(path.as_str()) {
            s.active_project = s.projects.first().map(|p| p.path.clone());
        }
    })?;
    watcher::restart(&app);
    Ok(())
}

#[tauri::command]
async fn open_path(path: String) -> Res<()> {
    tauri_plugin_opener::open_path(path, None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn open_unreal(app: AppHandle) -> Res<()> {
    let project = app.state::<AppState>().active_project()?;
    let uproject = std::fs::read_dir(&project.path)
        .map_err(|e| e.to_string())?
        .flatten()
        .map(|e| e.path())
        .find(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("uproject")))
        .ok_or("Keine .uproject-Datei im Projektordner gefunden")?;
    tauri_plugin_opener::open_path(uproject.to_string_lossy().into_owned(), None::<&str>).map_err(|e| e.to_string())
}

#[tauri::command]
async fn notify(app: AppHandle, title: String, body: String) -> Res<()> {
    app.notification().builder().title(title).body(body).show().map_err(|e| e.to_string())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let settings_path = app.path().app_config_dir()?.join("settings.json");
            let settings = Settings::load(&settings_path);
            app.manage(AppState {
                settings: parking_lot::Mutex::new(settings),
                settings_path,
                resource_dir: app.path().resource_dir().ok(),
                busy: Default::default(),
                locks: Default::default(),
                watcher: Default::default(),
            });

            // Tray-Icon
            let show = MenuItem::with_id(app, "show", "UnrealSync öffnen", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Beenden", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let mut tray = TrayIconBuilder::with_id("main")
                .tooltip("UnrealSync")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        show_main(tray.app_handle());
                    }
                });
            if let Some(icon) = app.default_window_icon() {
                tray = tray.icon(icon.clone());
            }
            tray.build(app)?;

            // Aktives Projekt vorbereiten (Agent-Pfad aktualisieren, Watcher starten)
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let st = handle.state::<AppState>();
                if let Ok(p) = st.active_project() {
                    let _ = project::ensure_storage(&st.git(), &PathBuf::from(&p.path));
                    let _ = locks::fetch_locks(&st, &PathBuf::from(&p.path));
                }
                watcher::restart(&handle);
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if app.state::<AppState>().settings().close_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_app_state,
            update_settings,
            select_project,
            remove_project,
            open_path,
            open_unreal,
            notify,
            github::github_device_start,
            github::github_device_poll,
            github::github_token_login,
            github::server_login,
            github::logout,
            github::github_list_repos,
            github::github_invitations,
            github::github_accept_invitation,
            github::team_members,
            github::team_invite,
            project::check_folder,
            project::create_project,
            project::join_project,
            project::submit_access_code,
            sync::get_status,
            sync::fetch_remote,
            sync::pull_changes,
            sync::upload_changes,
            sync::resolve_conflict,
            sync::continue_after_conflicts,
            sync::abort_sync,
            sync::discard_changes,
            sync::get_history,
            locks::get_locks,
            locks::lock_files,
            locks::unlock_files,
            locks::list_assets,
            storage::storage_info,
            storage::test_s3,
            storage::get_access_code,
            storage::migrate_storage,
            storage::prune_cache,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
