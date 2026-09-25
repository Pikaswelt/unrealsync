//! Projekt anlegen / beitreten, Repo-Konfiguration (.unrealsync.json) und Speicher-Backend.

use crate::git::Git;
use crate::github::Gh;
use crate::lfs_agent::AgentConfig;
use crate::s3::{S3Keys, S3Location, S3};
use crate::settings::{secrets, AccountKind, Project};
use crate::state::{blocking, emit_step, progress_cb, AppState, BusyGuard, Res};
use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

pub const CONFIG_FILE: &str = ".unrealsync.json";

const GITIGNORE: &str = r#"# --- UnrealSync: Unreal Engine ---
Binaries/
Intermediate/
Saved/
DerivedDataCache/
Build/
.vs/
.vscode/
.idea/
*.sln
*.suo
*.opensdf
*.sdf
*.VC.db
*.VC.opendb
Plugins/**/Binaries/
Plugins/**/Intermediate/
*.pdb
*.tmp
~$*
"#;

const GITATTRIBUTES: &str = r#"# --- UnrealSync: große Dateien über Git LFS, sperrbar ---
*.uasset filter=lfs diff=lfs merge=lfs -text lockable
*.umap filter=lfs diff=lfs merge=lfs -text lockable
*.fbx filter=lfs diff=lfs merge=lfs -text lockable
*.obj filter=lfs diff=lfs merge=lfs -text lockable
*.glb filter=lfs diff=lfs merge=lfs -text lockable
*.gltf filter=lfs diff=lfs merge=lfs -text
*.abc filter=lfs diff=lfs merge=lfs -text lockable
*.blend filter=lfs diff=lfs merge=lfs -text lockable
*.psd filter=lfs diff=lfs merge=lfs -text lockable
*.png filter=lfs diff=lfs merge=lfs -text lockable
*.jpg filter=lfs diff=lfs merge=lfs -text lockable
*.jpeg filter=lfs diff=lfs merge=lfs -text lockable
*.tga filter=lfs diff=lfs merge=lfs -text lockable
*.tif filter=lfs diff=lfs merge=lfs -text lockable
*.exr filter=lfs diff=lfs merge=lfs -text lockable
*.hdr filter=lfs diff=lfs merge=lfs -text lockable
*.wav filter=lfs diff=lfs merge=lfs -text lockable
*.mp3 filter=lfs diff=lfs merge=lfs -text lockable
*.ogg filter=lfs diff=lfs merge=lfs -text lockable
*.mp4 filter=lfs diff=lfs merge=lfs -text lockable
*.ttf filter=lfs diff=lfs merge=lfs -text
*.otf filter=lfs diff=lfs merge=lfs -text
*.zip filter=lfs diff=lfs merge=lfs -text
*.dll filter=lfs diff=lfs merge=lfs -text
*.exe filter=lfs diff=lfs merge=lfs -text
"#;

const SOURCE_EXT: &[&str] = &["blend", "psd", "max", "ma", "mb", "spp", "ztl", "kra", "aep"];
const SKIP_DIRS: &[&str] = &["binaries", "intermediate", "saved", "deriveddatacache", ".vs", ".git", ".idea", "build"];
pub const BIG_FILE: u64 = 100 * 1024 * 1024;

// ---------------------------------------------------------------- Repo-Konfiguration

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum StorageConfig {
    /// Git LFS des Git-Servers (GitHub oder eigener Server)
    Lfs,
    /// S3-kompatibler Cloud-Speicher (Cloudflare R2, Backblaze B2 …)
    S3(S3Location),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RepoConfig {
    pub version: u32,
    pub storage: StorageConfig,
}

impl Default for RepoConfig {
    fn default() -> Self {
        Self { version: 1, storage: StorageConfig::Lfs }
    }
}

pub fn read_repo_config(repo: &Path) -> RepoConfig {
    std::fs::read_to_string(repo.join(CONFIG_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn write_repo_config(repo: &Path, cfg: &RepoConfig) -> Res<()> {
    let json = serde_json::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    std::fs::write(repo.join(CONFIG_FILE), json + "\n").map_err(|e| e.to_string())
}

pub fn has_s3_keys(loc: &S3Location) -> bool {
    secrets::get(&loc.secret_key_name()).is_some()
}

pub fn store_s3_keys(loc: &S3Location, keys: &S3Keys) -> Res<()> {
    secrets::set(&loc.secret_key_name(), &serde_json::to_string(keys).map_err(|e| e.to_string())?)
}

pub fn load_s3_keys(loc: &S3Location) -> Option<S3Keys> {
    secrets::get(&loc.secret_key_name()).and_then(|s| serde_json::from_str(&s).ok())
}

pub fn encode_access_code(keys: &S3Keys) -> String {
    let json = serde_json::to_vec(keys).unwrap_or_default();
    format!("USYNC1.{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json))
}

pub fn decode_access_code(code: &str) -> Res<S3Keys> {
    let body = code.trim().strip_prefix("USYNC1.").ok_or("Das ist kein gültiger UnrealSync-Zugangscode")?;
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(body.trim())
        .map_err(|_| "Zugangscode ist beschädigt")?;
    serde_json::from_slice(&bytes).map_err(|_| "Zugangscode ist beschädigt".to_string())
}

/// Richtet Git LFS so ein, dass es den passenden Speicher nutzt.
pub fn apply_storage(git: &Git, repo: &Path, storage: &StorageConfig) -> Res<()> {
    const KEYS: &[&str] = &[
        "lfs.standalonetransferagent",
        "lfs.customtransfer.unrealsync.path",
        "lfs.customtransfer.unrealsync.args",
        "lfs.customtransfer.unrealsync.concurrent",
    ];
    match storage {
        StorageConfig::Lfs => {
            for k in KEYS {
                let _ = git.output(repo, &["config", "--local", "--unset-all", k]);
            }
        }
        StorageConfig::S3(loc) => {
            let exe = std::env::current_exe().map_err(|e| e.to_string())?;
            let tmp = repo.join(".git").join("lfs").join("tmp");
            let _ = std::fs::create_dir_all(&tmp);
            let cfg = AgentConfig { location: loc.clone(), tmp_dir: tmp.to_string_lossy().into_owned() };
            let args = format!("lfs-agent {}", cfg.encode());
            let exe_s = exe.to_string_lossy().replace('\\', "/");
            for (k, v) in [
                ("lfs.standalonetransferagent", "unrealsync"),
                ("lfs.customtransfer.unrealsync.path", exe_s.as_str()),
                ("lfs.customtransfer.unrealsync.args", args.as_str()),
                ("lfs.customtransfer.unrealsync.concurrent", "true"),
            ] {
                git.run(repo, &["config", "--local", k, v])?;
            }
        }
    }
    Ok(())
}

/// Lokale Git-Einstellungen, die jedes UnrealSync-Repo braucht.
pub fn setup_local(git: &Git, repo: &Path, name: &str, email: &str) -> Res<()> {
    git.run(repo, &["lfs", "install", "--local"])?;
    for (k, v) in [
        ("user.name", name),
        ("user.email", email),
        ("core.longpaths", "true"),
        ("core.autocrlf", "false"),
        ("lfs.locksverify", "true"),
        ("lfs.setlockablereadonly", "true"),
        ("pull.rebase", "true"),
        ("rebase.autoStash", "false"),
        ("push.autoSetupRemote", "true"),
    ] {
        git.run(repo, &["config", "--local", k, v])?;
    }
    Ok(())
}

/// Wird bei jedem Projektstart aufgerufen (z. B. neuer EXE-Pfad nach Update).
/// Liefert `true`, wenn ein Zugangscode für den Cloud-Speicher fehlt.
pub fn ensure_storage(git: &Git, repo: &Path) -> Res<bool> {
    let cfg = read_repo_config(repo);
    if let StorageConfig::S3(loc) = &cfg.storage {
        if !has_s3_keys(loc) {
            return Ok(true);
        }
    }
    apply_storage(git, repo, &cfg.storage)?;
    Ok(false)
}

// ---------------------------------------------------------------- Ordner prüfen

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FolderCheck {
    pub exists: bool,
    pub uproject: Option<String>,
    pub in_onedrive: bool,
    pub is_git_repo: bool,
    pub total_bytes: u64,
    pub file_count: u64,
    pub big_files: Vec<(String, u64)>,
    pub source_files: Vec<(String, u64)>,
}

pub fn in_onedrive(path: &Path) -> bool {
    let p = path.to_string_lossy().to_lowercase();
    if p.contains("\\onedrive") || p.contains("/onedrive") {
        return true;
    }
    ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"].iter().any(|v| {
        std::env::var(v)
            .map(|od| !od.is_empty() && p.starts_with(&od.to_lowercase()))
            .unwrap_or(false)
    })
}

fn walk(root: &Path, dir: &Path, out: &mut FolderCheck) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_dir() {
            if !SKIP_DIRS.contains(&name.as_str()) {
                walk(root, &path, out);
            }
        } else {
            let size = meta.len();
            out.total_bytes += size;
            out.file_count += 1;
            let rel = path.strip_prefix(root).unwrap_or(&path).to_string_lossy().replace('\\', "/");
            if size > BIG_FILE {
                out.big_files.push((rel.clone(), size));
            }
            let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if SOURCE_EXT.contains(&ext.as_str()) {
                out.source_files.push((rel, size));
            }
        }
    }
}

#[tauri::command]
pub async fn check_folder(path: String) -> Res<FolderCheck> {
    blocking(move || {
        let root = PathBuf::from(&path);
        let mut out = FolderCheck { exists: root.is_dir(), in_onedrive: in_onedrive(&root), ..Default::default() };
        if !out.exists {
            return Ok(out);
        }
        out.is_git_repo = root.join(".git").exists();
        out.uproject = std::fs::read_dir(&root).ok().and_then(|rd| {
            rd.flatten()
                .map(|e| e.file_name().to_string_lossy().into_owned())
                .find(|n| n.to_lowercase().ends_with(".uproject"))
        });
        walk(&root, &root, &mut out);
        out.big_files.sort_by(|a, b| b.1.cmp(&a.1));
        Ok(out)
    })
    .await
}

// ---------------------------------------------------------------- Neues Projekt hochladen

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum StorageInput {
    Lfs,
    S3 { location: S3Location, keys: S3Keys },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateInput {
    pub path: String,
    pub repo_name: String,
    pub private: bool,
    pub storage: StorageInput,
    /// Nur bei eigenem Git-Server: URL eines leeren Repos
    pub server_repo_url: Option<String>,
    pub invite: Option<String>,
}

fn ensure_block(file: &Path, marker: &str, content: &str) -> Res<()> {
    let existing = std::fs::read_to_string(file).unwrap_or_default();
    if existing.contains(marker) {
        return Ok(());
    }
    let mut new = existing;
    if !new.is_empty() && !new.ends_with('\n') {
        new.push('\n');
    }
    new.push_str(content);
    std::fs::write(file, new).map_err(|e| format!("{}: {e}", file.display()))
}

#[tauri::command]
pub async fn create_project(app: AppHandle, input: CreateInput) -> Res<Project> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Projekt hochladen")?;
        let (acc, token) = st.account()?;
        let git = st.git();
        let repo = PathBuf::from(&input.path);
        let op = "create";

        if !repo.is_dir() {
            return Err("Ordner nicht gefunden".into());
        }

        emit_step(&app, op, "Projektdateien vorbereiten", None);
        ensure_block(&repo.join(".gitignore"), "UnrealSync: Unreal Engine", GITIGNORE)?;
        ensure_block(&repo.join(".gitattributes"), "UnrealSync: große Dateien", GITATTRIBUTES)?;

        let storage = match &input.storage {
            StorageInput::Lfs => StorageConfig::Lfs,
            StorageInput::S3 { location, keys } => {
                emit_step(&app, op, "Cloud-Speicher prüfen", None);
                S3::new(location.clone(), keys.clone()).self_test()?;
                store_s3_keys(location, keys)?;
                StorageConfig::S3(location.clone())
            }
        };
        write_repo_config(&repo, &RepoConfig { version: 1, storage: storage.clone() })?;

        emit_step(&app, op, "Git einrichten", None);
        if !repo.join(".git").exists() {
            git.run(&repo, &["init", "-b", "main"])?;
        }
        setup_local(&git, &repo, &acc.login, &acc.email)?;
        apply_storage(&git, &repo, &storage)?;

        // Remote anlegen
        let (remote_url, github_repo) = match acc.kind {
            AccountKind::Github => {
                emit_step(&app, op, "GitHub-Repository anlegen", None);
                let r = Gh::new(&token).create_repo(input.repo_name.trim(), input.private)?;
                (r.clone_url, Some(r.full_name))
            }
            AccountKind::Server => {
                let url = input.server_repo_url.clone().filter(|u| !u.trim().is_empty()).ok_or("Repo-URL fehlt")?;
                (url.trim().to_string(), None)
            }
        };
        if git.run(&repo, &["remote", "get-url", "origin"]).is_ok() {
            git.run(&repo, &["remote", "set-url", "origin", &remote_url])?;
        } else {
            git.run(&repo, &["remote", "add", "origin", &remote_url])?;
        }

        emit_step(&app, op, "Dateien einlesen (kann bei großen Projekten dauern)", None);
        git.run(&repo, &["add", "-A"])?;
        let has_head = git.run(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok();
        let staged = git.run(&repo, &["diff", "--cached", "--name-only"])?;
        if !staged.trim().is_empty() || !has_head {
            git.run(&repo, &["commit", "--allow-empty", "-m", "Projekt mit UnrealSync hochgeladen"])?;
        }
        git.run(&repo, &["branch", "-M", "main"])?;

        emit_step(&app, op, "Hochladen", Some(0.0));
        git.run_stream(&repo, &["push", "--progress", "-u", "origin", "main"], &[], progress_cb(&app, op, "Hochladen"))?;

        if let (Some(user), Some(gr)) = (input.invite.as_ref().filter(|u| !u.trim().is_empty()), github_repo.as_ref()) {
            emit_step(&app, op, "Teammitglied einladen", None);
            Gh::new(&token).add_collaborator(gr, user.trim().trim_start_matches('@'))?;
        }

        let name = input.repo_name.trim().to_string();
        let project = Project { name, path: input.path.clone(), remote_url, github_repo };
        st.update_settings(|s| s.upsert_project(project.clone()))?;
        crate::watcher::restart(&app);
        Ok(project)
    })
    .await
}

// ---------------------------------------------------------------- Projekt beitreten

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinInput {
    pub clone_url: String,
    pub parent_dir: String,
    pub folder_name: String,
    pub github_repo: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinResult {
    pub project: Project,
    pub needs_access_code: bool,
}

#[tauri::command]
pub async fn join_project(app: AppHandle, input: JoinInput) -> Res<JoinResult> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Projekt herunterladen")?;
        let (acc, _) = st.account()?;
        let git = st.git();
        let op = "join";
        let parent = PathBuf::from(&input.parent_dir);
        let target = parent.join(input.folder_name.trim());
        if target.exists() && std::fs::read_dir(&target).map(|mut d| d.next().is_some()).unwrap_or(false) {
            return Err(format!("Der Ordner {} ist nicht leer", target.display()));
        }
        std::fs::create_dir_all(&parent).map_err(|e| e.to_string())?;

        emit_step(&app, op, "Projekt herunterladen", Some(0.0));
        let target_s = target.to_string_lossy().into_owned();
        git.run_stream(
            &parent,
            &["clone", "--progress", input.clone_url.trim(), &target_s],
            &[("GIT_LFS_SKIP_SMUDGE", "1")],
            progress_cb(&app, op, "Projekt herunterladen"),
        )?;
        setup_local(&git, &target, &acc.login, &acc.email)?;

        let name = input.folder_name.trim().to_string();
        let project = Project {
            name,
            path: target_s.clone(),
            remote_url: input.clone_url.trim().to_string(),
            github_repo: input.github_repo.clone(),
        };
        st.update_settings(|s| s.upsert_project(project.clone()))?;

        let needs_access_code = ensure_storage(&git, &target)?;
        if !needs_access_code {
            emit_step(&app, op, "Große Dateien herunterladen", Some(0.0));
            git.run_stream(&target, &["lfs", "pull"], &[], progress_cb(&app, op, "Große Dateien herunterladen"))?;
        }
        crate::watcher::restart(&app);
        Ok(JoinResult { project, needs_access_code })
    })
    .await
}

/// Zugangscode für den Cloud-Speicher eingeben (Teammitglied) und große Dateien laden.
#[tauri::command]
pub async fn submit_access_code(app: AppHandle, code: String) -> Res<()> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Große Dateien herunterladen")?;
        let project = st.active_project()?;
        let repo = PathBuf::from(&project.path);
        let cfg = read_repo_config(&repo);
        let StorageConfig::S3(loc) = cfg.storage else {
            return Err("Dieses Projekt nutzt keinen Cloud-Speicher".into());
        };
        let keys = decode_access_code(&code)?;
        S3::new(loc.clone(), keys.clone()).self_test()?;
        store_s3_keys(&loc, &keys)?;
        let git = st.git();
        apply_storage(&git, &repo, &StorageConfig::S3(loc))?;
        emit_step(&app, "access", "Große Dateien herunterladen", Some(0.0));
        git.run_stream(&repo, &["lfs", "pull"], &[], progress_cb(&app, "access", "Große Dateien herunterladen"))?;
        Ok(())
    })
    .await
}
