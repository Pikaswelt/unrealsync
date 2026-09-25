//! Beobachtet Content/ und Config/: warnt, wenn man ein fremd gesperrtes Asset ändert,
//! und sperrt eigene Änderungen automatisch.

use crate::locks;
use crate::state::AppState;
use notify::{EventKind, RecursiveMode, Watcher};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn restart(app: &AppHandle) {
    let st = app.state::<AppState>();
    *st.watcher.lock() = None;
    let Ok(project) = st.active_project() else { return };
    let repo = PathBuf::from(&project.path);

    let recent: Arc<Mutex<HashMap<String, Instant>>> = Arc::default();
    let app2 = app.clone();
    let repo2 = repo.clone();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let Ok(event) = res else { return };
        if !matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)) {
            return;
        }
        let st = app2.state::<AppState>();
        if st.is_busy() {
            return; // eigene Git-Vorgänge ignorieren
        }
        for path in event.paths {
            let Ok(rel) = path.strip_prefix(&repo2) else { continue };
            let rel = rel.to_string_lossy().replace('\\', "/");
            let lower = rel.to_lowercase();
            let _ = app2.emit("fs-changed", &rel);
            if !(lower.ends_with(".uasset") || lower.ends_with(".umap")) {
                continue;
            }
            {
                let mut r = recent.lock();
                if r.get(&rel).is_some_and(|t| t.elapsed() < Duration::from_secs(10)) {
                    continue;
                }
                r.insert(rel.clone(), Instant::now());
            }
            let app3 = app2.clone();
            let repo3 = repo2.clone();
            std::thread::spawn(move || on_asset_changed(&app3, &repo3, rel));
        }
    });
    let Ok(mut watcher) = watcher else { return };
    for dir in ["Content", "Config", "Source", "Plugins"] {
        let p = repo.join(dir);
        if p.exists() {
            let _ = watcher.watch(&p, RecursiveMode::Recursive);
        }
    }
    *st.watcher.lock() = Some(watcher);
}

fn on_asset_changed(app: &AppHandle, repo: &Path, rel: String) {
    // Unreal speichert in Schüben – kurz warten
    std::thread::sleep(Duration::from_millis(1500));
    let st = app.state::<AppState>();
    let cached = st.locks.lock().clone();
    let name = crate::sync::classify(&rel).1.unwrap_or_else(|| rel.clone());

    if let Some(l) = cached.iter().find(|l| l.path == rel && !l.ours) {
        let _ = app
            .notification()
            .builder()
            .title("⚠ Achtung: gesperrtes Asset")
            .body(format!("{} bearbeitet gerade {name}. Deine Änderung kann nicht hochgeladen werden.", l.owner))
            .show();
        let _ = app.emit("lock-conflict", &rel);
        return;
    }
    if cached.iter().any(|l| l.path == rel && l.ours) || !st.settings().auto_lock {
        return;
    }
    // Nur Dateien, die schon im Repo sind (neue Assets kann niemand anderes haben)
    let git = st.git();
    if git.run(repo, &["ls-files", "--error-unmatch", "--", &rel]).is_err() {
        return;
    }
    // Aktuellen Stand vom Server – vielleicht hat jemand gerade gesperrt
    let fresh = locks::fetch_locks(&st, repo).unwrap_or(cached);
    if let Some(l) = fresh.iter().find(|l| l.path == rel && !l.ours) {
        let _ = app
            .notification()
            .builder()
            .title("⚠ Achtung: gesperrtes Asset")
            .body(format!("{} bearbeitet gerade {name}.", l.owner))
            .show();
        let _ = app.emit("lock-conflict", &rel);
        return;
    }
    if fresh.iter().any(|l| l.path == rel) {
        return;
    }
    if locks::lock_paths(&st, repo, std::slice::from_ref(&rel)).is_empty() {
        let _ = locks::fetch_locks(&st, repo);
        let _ = app.emit("locks-changed", ());
        let _ = app.emit("auto-locked", &rel);
    }
}
