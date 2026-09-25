//! Speicheranzeige, Verbindungstest und „Speicher umziehen“.

use crate::project::{
    apply_storage, encode_access_code, load_s3_keys, read_repo_config, store_s3_keys, write_repo_config, RepoConfig,
    StorageConfig, CONFIG_FILE,
};
use crate::s3::{S3Keys, S3Location, S3};
use crate::settings::AccountKind;
use crate::state::{blocking, emit_step, progress_cb, AppState, BusyGuard, Res};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const GITHUB_FREE_BYTES: u64 = 10 * 1024 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    /// github | server | s3
    pub backend: String,
    pub location: Option<S3Location>,
    pub lfs_bytes: u64,
    pub lfs_files: u64,
    pub local_cache_bytes: u64,
    pub quota_bytes: Option<u64>,
    pub has_keys: bool,
}

fn dir_size(p: &Path) -> u64 {
    let Ok(rd) = std::fs::read_dir(p) else { return 0 };
    rd.flatten()
        .map(|e| match e.metadata() {
            Ok(m) if m.is_dir() => dir_size(&e.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

#[tauri::command]
pub async fn storage_info(app: AppHandle) -> Res<StorageInfo> {
    blocking(move || {
        let st = app.state::<AppState>();
        let project = st.active_project()?;
        let repo = PathBuf::from(&project.path);
        let git = st.git();
        let cfg = read_repo_config(&repo);

        // Alle LFS-Objekte der gesamten Historie (einmalig gezählt)
        let mut seen = std::collections::HashSet::new();
        let mut bytes = 0u64;
        if let Ok(out) = git.run(&repo, &["lfs", "ls-files", "--all", "--json"]) {
            let v: Value = serde_json::from_str(&out).unwrap_or(Value::Null);
            for f in v["files"].as_array().into_iter().flatten() {
                if seen.insert(f["oid"].as_str().unwrap_or_default().to_string()) {
                    bytes += f["size"].as_u64().unwrap_or(0);
                }
            }
        }
        let is_github = st.settings().account.map(|a| a.kind == AccountKind::Github).unwrap_or(false) && project.github_repo.is_some();
        let (backend, location, quota, has_keys) = match cfg.storage {
            StorageConfig::S3(loc) => {
                let has = load_s3_keys(&loc).is_some();
                ("s3", Some(loc), None, has)
            }
            StorageConfig::Lfs if is_github => ("github", None, Some(GITHUB_FREE_BYTES), true),
            StorageConfig::Lfs => ("server", None, None, true),
        };
        Ok(StorageInfo {
            backend: backend.into(),
            location,
            lfs_bytes: bytes,
            lfs_files: seen.len() as u64,
            local_cache_bytes: dir_size(&repo.join(".git").join("lfs").join("objects")),
            quota_bytes: quota,
            has_keys,
        })
    })
    .await
}

#[tauri::command]
pub async fn test_s3(location: S3Location, keys: S3Keys) -> Res<()> {
    blocking(move || S3::new(location, keys).self_test()).await
}

/// Zugangscode für Teammitglieder (enthält die S3-Schlüssel – nur privat teilen!)
#[tauri::command]
pub async fn get_access_code(app: AppHandle) -> Res<String> {
    blocking(move || {
        let project = app.state::<AppState>().active_project()?;
        match read_repo_config(Path::new(&project.path)).storage {
            StorageConfig::S3(loc) => {
                load_s3_keys(&loc).map(|k| encode_access_code(&k)).ok_or_else(|| "Keine Schlüssel hinterlegt".into())
            }
            StorageConfig::Lfs => Err("Dieses Projekt nutzt keinen Cloud-Speicher".into()),
        }
    })
    .await
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum MigrateTarget {
    Lfs,
    S3 { location: S3Location, keys: S3Keys },
}

/// Zieht alle großen Dateien (inkl. Historie) in einen anderen Speicher um.
#[tauri::command]
pub async fn migrate_storage(app: AppHandle, target: MigrateTarget) -> Res<()> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Speicher umziehen")?;
        let project = st.active_project()?;
        let repo = PathBuf::from(&project.path);
        let git = st.git();
        let op = "migrate";

        let status = crate::sync::read_status(&st, &repo)?;
        if status.changes.iter().any(|c| c.path == CONFIG_FILE) {
            return Err(format!("{CONFIG_FILE} hat lokale Änderungen – bitte zuerst hochladen oder verwerfen"));
        }

        let new_storage = match &target {
            MigrateTarget::Lfs => StorageConfig::Lfs,
            MigrateTarget::S3 { location, keys } => {
                emit_step(&app, op, "Cloud-Speicher prüfen", None);
                S3::new(location.clone(), keys.clone()).self_test()?;
                store_s3_keys(location, keys)?;
                StorageConfig::S3(location.clone())
            }
        };

        // 1) Alles aus dem alten Speicher lokal holen
        emit_step(&app, op, "Alle großen Dateien vom alten Speicher laden", Some(0.0));
        git.run_stream(&repo, &["lfs", "fetch", "--all", "origin"], &[], progress_cb(&app, op, "Alle großen Dateien vom alten Speicher laden"))?;

        // 2) Auf neuen Speicher umstellen und alles hochladen
        apply_storage(&git, &repo, &new_storage)?;
        emit_step(&app, op, "In den neuen Speicher hochladen", Some(0.0));
        let old = read_repo_config(&repo);
        let upload = git.run_stream(&repo, &["lfs", "push", "--all", "origin"], &[], progress_cb(&app, op, "In den neuen Speicher hochladen"));
        if let Err(e) = upload {
            let _ = apply_storage(&git, &repo, &old.storage);
            return Err(e);
        }

        // 3) Neue Konfiguration fürs Team hochladen
        emit_step(&app, op, "Team informieren", None);
        write_repo_config(&repo, &RepoConfig { version: 1, storage: new_storage })?;
        git.run(&repo, &["add", CONFIG_FILE])?;
        git.run(&repo, &["commit", "-m", "UnrealSync: Speicher umgezogen", "--", CONFIG_FILE])?;
        if crate::sync::integrate_remote(&app, &st, &repo, op)?.is_some() {
            return Err("Beim Zusammenführen gab es Konflikte – bitte in der Übersicht lösen und dann hochladen".into());
        }
        git.run_stream(&repo, &["push", "--progress", "origin", "HEAD:main"], &[], progress_cb(&app, op, "Team informieren"))?;
        Ok(())
    })
    .await
}

/// Lokalen LFS-Cache aufräumen (alte Versionen, die schon hochgeladen sind).
#[tauri::command]
pub async fn prune_cache(app: AppHandle) -> Res<String> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Aufräumen")?;
        let project = st.active_project()?;
        st.git().run(Path::new(&project.path), &["lfs", "prune", "--verify-remote"])
    })
    .await
}
