//! Datei-Sperren über die Git-LFS-Lock-API ("Wer arbeitet woran?").

use crate::state::{blocking, AppState, Res};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LockInfo {
    pub id: String,
    pub path: String,
    pub owner: String,
    pub locked_at: String,
    pub ours: bool,
}

fn parse(v: &Value, ours: Option<bool>, me: &str) -> Vec<LockInfo> {
    v.as_array()
        .into_iter()
        .flatten()
        .map(|l| {
            let owner = l["owner"]["name"].as_str().unwrap_or("?").to_string();
            LockInfo {
                id: l["id"].as_str().unwrap_or_default().into(),
                path: l["path"].as_str().unwrap_or_default().into(),
                ours: ours.unwrap_or_else(|| owner.eq_ignore_ascii_case(me)),
                owner,
                locked_at: l["locked_at"].as_str().unwrap_or_default().into(),
            }
        })
        .collect()
}

/// Holt alle Sperren vom Server und aktualisiert den Cache.
pub fn fetch_locks(st: &AppState, repo: &Path) -> Res<Vec<LockInfo>> {
    let git = st.git();
    let me = st.settings().account.map(|a| a.login).unwrap_or_default();
    let locks = match git.run(repo, &["lfs", "locks", "--verify", "--json"]) {
        Ok(out) => {
            let v: Value = serde_json::from_str(&out).unwrap_or(Value::Null);
            let mut l = parse(&v["ours"], Some(true), &me);
            l.extend(parse(&v["theirs"], Some(false), &me));
            l
        }
        Err(_) => {
            let out = git.run(repo, &["lfs", "locks", "--json"])?;
            parse(&serde_json::from_str(&out).unwrap_or(Value::Null), None, &me)
        }
    };
    *st.locks.lock() = locks.clone();
    Ok(locks)
}

fn repo_of(app: &AppHandle) -> Res<PathBuf> {
    Ok(PathBuf::from(app.state::<AppState>().active_project()?.path))
}

#[tauri::command]
pub async fn get_locks(app: AppHandle) -> Res<Vec<LockInfo>> {
    blocking(move || fetch_locks(&app.state::<AppState>(), &repo_of(&app)?)).await
}

/// Sperrt Dateien für mich. Liefert pro Datei eine Fehlermeldung, falls es nicht klappt.
pub fn lock_paths(st: &AppState, repo: &Path, paths: &[String]) -> Vec<(String, String)> {
    let git = st.git();
    let mut errors = vec![];
    for p in paths {
        if let Err(e) = git.run(repo, &["lfs", "lock", "--json", p]) {
            errors.push((p.clone(), e));
        }
    }
    errors
}

#[tauri::command]
pub async fn lock_files(app: AppHandle, paths: Vec<String>) -> Res<Vec<LockInfo>> {
    blocking(move || {
        let st = app.state::<AppState>();
        let repo = repo_of(&app)?;
        let errors = lock_paths(&st, &repo, &paths);
        let locks = fetch_locks(&st, &repo)?;
        let _ = app.emit("locks-changed", ());
        if !errors.is_empty() {
            return Err(errors.iter().map(|(p, e)| format!("{p}: {e}")).collect::<Vec<_>>().join("\n"));
        }
        Ok(locks)
    })
    .await
}

pub fn unlock_paths(st: &AppState, repo: &Path, paths: &[String], force: bool) -> Vec<(String, String)> {
    let git = st.git();
    let mut errors = vec![];
    for p in paths {
        let mut args = vec!["lfs", "unlock"];
        if force {
            args.push("--force");
        }
        args.push(p);
        if let Err(e) = git.run(repo, &args) {
            errors.push((p.clone(), e));
        }
    }
    errors
}

#[tauri::command]
pub async fn unlock_files(app: AppHandle, paths: Vec<String>, force: bool) -> Res<Vec<LockInfo>> {
    blocking(move || {
        let st = app.state::<AppState>();
        let repo = repo_of(&app)?;
        let errors = unlock_paths(&st, &repo, &paths, force);
        let locks = fetch_locks(&st, &repo)?;
        let _ = app.emit("locks-changed", ());
        if !errors.is_empty() {
            let msg = errors.iter().map(|(p, e)| format!("{p}: {e}")).collect::<Vec<_>>().join("\n");
            if msg.contains("uncommitted") || msg.contains("modified") {
                return Err(format!("Du hast an diesen Dateien noch ungespeicherte Änderungen. Lade sie zuerst hoch oder verwirf sie.\n\n{msg}"));
            }
            return Err(msg);
        }
        Ok(locks)
    })
    .await
}

/// Alle sperrbaren Assets im Projekt (für die Suche „Ich bearbeite …“).
#[tauri::command]
pub async fn list_assets(app: AppHandle, query: String) -> Res<Vec<String>> {
    blocking(move || {
        let st = app.state::<AppState>();
        let repo = repo_of(&app)?;
        let out = st.git().run(&repo, &["ls-files", "--", "*.uasset", "*.umap"])?;
        let q = query.to_lowercase();
        let words: Vec<&str> = q.split_whitespace().collect();
        Ok(out
            .lines()
            .filter(|l| {
                let low = l.to_lowercase();
                words.iter().all(|w| low.contains(w))
            })
            .take(300)
            .map(str::to_string)
            .collect())
    })
    .await
}
