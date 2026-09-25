//! Status, Änderungen holen / hochladen, Konflikte, Verlauf.

use crate::locks;
use crate::state::{blocking, emit_step, progress_cb, AppState, BusyGuard, Res};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub path: String,
    pub old_path: Option<String>,
    /// modified | added | deleted | renamed | conflict
    pub status: String,
    /// asset | map | code | config | other
    pub kind: String,
    /// Unreal-Pfad, z. B. /Game/Maps/Level1
    pub asset: Option<String>,
    pub size: Option<u64>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CommitInfo {
    pub hash: String,
    pub short: String,
    pub author: String,
    pub date: String,
    pub message: String,
    pub files: Vec<(String, String)>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub branch: String,
    pub has_upstream: bool,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<Change>,
    pub conflicts: Vec<String>,
    pub rebase_in_progress: bool,
    pub unreal_running: bool,
    pub incoming: Vec<CommitInfo>,
    pub needs_access_code: bool,
}

pub fn classify(path: &str) -> (String, Option<String>) {
    let lower = path.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");
    let kind = match ext {
        "umap" => "map",
        "uasset" => "asset",
        "cpp" | "h" | "hpp" | "cs" | "c" | "inl" => "code",
        "ini" | "uproject" | "uplugin" | "json" => "config",
        _ => "other",
    };
    let asset = if kind == "map" || kind == "asset" {
        let no_ext = &path[..path.len() - ext.len() - 1];
        if let Some(rest) = no_ext.strip_prefix("Content/") {
            Some(format!("/Game/{rest}"))
        } else if let Some(rest) = no_ext.strip_prefix("Plugins/") {
            // Plugins/<Name>/Content/... -> /<Name>/...
            rest.split_once("/Content/").map(|(plugin, p)| format!("/{}/{p}", plugin.rsplit('/').next().unwrap_or(plugin)))
        } else {
            None
        }
    } else {
        None
    };
    (kind.to_string(), asset)
}

pub fn unreal_running() -> bool {
    let mut cmd = std::process::Command::new("tasklist");
    cmd.args(["/NH", "/FO", "CSV"]);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    cmd.output()
        .map(|o| {
            let s = String::from_utf8_lossy(&o.stdout).to_lowercase();
            s.contains("\"unrealeditor.exe\"") || s.contains("\"ue4editor.exe\"") || s.contains("\"unrealeditor-cmd.exe\"")
        })
        .unwrap_or(false)
}

fn repo_of(app: &AppHandle) -> Res<PathBuf> {
    Ok(PathBuf::from(app.state::<AppState>().active_project()?.path))
}

fn rebase_in_progress(repo: &Path) -> bool {
    let g = repo.join(".git");
    g.join("rebase-merge").exists() || g.join("rebase-apply").exists()
}

fn parse_log(out: &str) -> Vec<CommitInfo> {
    out.split('\u{1e}')
        .filter(|c| !c.trim().is_empty())
        .filter_map(|chunk| {
            let mut lines = chunk.trim_matches('\n').lines();
            let header = lines.next()?;
            let f: Vec<&str> = header.split('\u{1f}').collect();
            if f.len() < 5 {
                return None;
            }
            let files = lines
                .filter_map(|l| {
                    let mut parts = l.split('\t');
                    let st = parts.next()?.chars().next()?.to_string();
                    let path = parts.last()?.to_string();
                    Some((st, path))
                })
                .collect();
            Some(CommitInfo {
                hash: f[0].into(),
                short: f[1].into(),
                author: f[2].into(),
                date: f[3].into(),
                message: f[4].into(),
                files,
            })
        })
        .collect()
}

const LOG_FMT: &str = "--format=%x1e%H%x1f%h%x1f%an%x1f%aI%x1f%s";

pub fn read_status(st: &AppState, repo: &Path) -> Res<Status> {
    let git = st.git();
    let out = git.run(repo, &["status", "--porcelain=v1", "-z", "-uall", "--branch"])?;
    let mut entries = out.split('\0').filter(|s| !s.is_empty());
    let mut s = Status {
        branch: "main".into(),
        has_upstream: false,
        ahead: 0,
        behind: 0,
        changes: vec![],
        conflicts: vec![],
        rebase_in_progress: rebase_in_progress(repo),
        unreal_running: unreal_running(),
        incoming: vec![],
        needs_access_code: false,
    };
    while let Some(e) = entries.next() {
        if let Some(b) = e.strip_prefix("## ") {
            let (names, rest) = b.split_once(" [").unwrap_or((b, ""));
            let (local, upstream) = names.split_once("...").unwrap_or((names, ""));
            s.branch = local.trim_start_matches("No commits yet on ").to_string();
            s.has_upstream = !upstream.is_empty();
            for part in rest.trim_end_matches(']').split(", ") {
                if let Some(n) = part.strip_prefix("ahead ") {
                    s.ahead = n.parse().unwrap_or(0);
                } else if let Some(n) = part.strip_prefix("behind ") {
                    s.behind = n.parse().unwrap_or(0);
                }
            }
            continue;
        }
        if e.len() < 4 {
            continue;
        }
        let (x, y) = (e.as_bytes()[0] as char, e.as_bytes()[1] as char);
        let path = e[3..].to_string();
        let mut old_path = None;
        if x == 'R' || x == 'C' {
            old_path = entries.next().map(str::to_string);
        }
        let conflict = matches!((x, y), ('U', _) | (_, 'U') | ('A', 'A') | ('D', 'D'));
        let status = if conflict {
            s.conflicts.push(path.clone());
            "conflict"
        } else if x == '?' || x == 'A' {
            "added"
        } else if x == 'D' || y == 'D' {
            "deleted"
        } else if x == 'R' {
            "renamed"
        } else {
            "modified"
        };
        let (kind, asset) = classify(&path);
        let size = std::fs::metadata(repo.join(&path)).ok().map(|m| m.len());
        s.changes.push(Change { path, old_path, status: status.into(), kind, asset, size });
    }
    if s.behind > 0 {
        if let Ok(log) = git.run(repo, &["log", "HEAD..@{u}", "--name-status", LOG_FMT]) {
            s.incoming = parse_log(&log);
        }
    }
    s.needs_access_code = matches!(
        crate::project::read_repo_config(repo).storage,
        crate::project::StorageConfig::S3(ref loc) if !crate::project::has_s3_keys(loc)
    );
    Ok(s)
}

#[tauri::command]
pub async fn get_status(app: AppHandle) -> Res<Status> {
    blocking(move || read_status(&app.state::<AppState>(), &repo_of(&app)?)).await
}

/// Prüft den Server auf neue Änderungen (ohne etwas zu verändern).
#[tauri::command]
pub async fn fetch_remote(app: AppHandle) -> Res<Status> {
    blocking(move || {
        let st = app.state::<AppState>();
        let repo = repo_of(&app)?;
        if !st.is_busy() {
            st.git().run(&repo, &["fetch", "--prune", "--quiet", "origin"])?;
        }
        let _ = locks::fetch_locks(&st, &repo);
        read_status(&st, &repo)
    })
    .await
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// done | conflict
    pub result: String,
    pub conflicts: Vec<String>,
    pub message: String,
}

fn conflicts_now(st: &AppState, repo: &Path) -> Vec<String> {
    st.git()
        .run(repo, &["diff", "--name-only", "--diff-filter=U"])
        .map(|o| crate::git::lines(&o))
        .unwrap_or_default()
}

const STASH_MARK: &str = "UnrealSync-Sicherung";

fn count(st: &AppState, repo: &Path, range: &str) -> u32 {
    st.git()
        .run(repo, &["rev-list", "--count", range])
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

fn is_dirty(st: &AppState, repo: &Path) -> Res<bool> {
    Ok(!st.git().run(repo, &["status", "--porcelain", "-uall"])?.trim().is_empty())
}

/// Stellt eine von UnrealSync angelegte Sicherung wieder her (nur wenn sie oben liegt).
/// Bei Konflikten bleibt die Sicherung in der Stash-Liste erhalten.
fn restore_our_stash(st: &AppState, repo: &Path) -> Res<Option<SyncResult>> {
    let git = st.git();
    let top = git.run(repo, &["stash", "list", "-n1", "--format=%s"]).unwrap_or_default();
    if !top.contains(STASH_MARK) {
        return Ok(None);
    }
    let res = git.run(repo, &["stash", "pop"]);
    let conflicts = conflicts_now(st, repo);
    if !conflicts.is_empty() {
        return Ok(Some(SyncResult {
            result: "conflict".into(),
            conflicts,
            message: "Deine noch nicht hochgeladenen Änderungen überschneiden sich mit denen vom Team. Entscheide pro Datei.".into(),
        }));
    }
    res.map(|_| None).map_err(|e| {
        format!("Deine lokalen Änderungen liegen sicher in der Git-Sicherung „{STASH_MARK}“, konnten aber nicht automatisch zurückgespielt werden.\n\n{e}")
    })
}

/// Holt Änderungen vom Server – sicher: große Dateien werden VOR jeder Änderung am Projektordner
/// geladen, lokale Änderungen werden nie stillschweigend beiseitegelegt.
pub fn integrate_remote<E: crate::state::Emit + ?Sized>(app: &E, st: &AppState, repo: &Path, op: &str) -> Res<Option<SyncResult>> {
    let git = st.git();
    // Reste eines alten Git-Autostash sichtbar sichern, statt sie zu verlieren
    if let Ok(sha) = git.run(repo, &["rev-parse", "-q", "--verify", "MERGE_AUTOSTASH"]) {
        let sha = sha.trim().to_string();
        git.run(repo, &["stash", "store", "-m", "UnrealSync: wiederhergestellte Sicherung", &sha])?;
        let _ = git.run(repo, &["update-ref", "-d", "MERGE_AUTOSTASH"]);
    }
    emit_step(app, op, "Server prüfen", None);
    git.run_stream(repo, &["fetch", "--progress", "origin"], &[], progress_cb(app, op, "Server prüfen"))?;
    if git.run(repo, &["rev-parse", "--verify", "-q", "refs/remotes/origin/main"]).is_err() {
        return Ok(None); // Remote noch leer
    }
    let behind = count(st, repo, "HEAD..origin/main");
    if behind == 0 {
        return Ok(None);
    }
    let ahead = count(st, repo, "origin/main..HEAD");

    // 1) Große Dateien vorab laden – scheitert das, bleibt der Projektordner unberührt.
    emit_step(app, op, "Große Dateien herunterladen", Some(0.0));
    git.run_stream(repo, &["lfs", "fetch", "origin", "origin/main"], &[], progress_cb(app, op, "Große Dateien herunterladen"))?;

    // 2a) Keine eigenen Commits: Fast-Forward. Git bricht ab, statt lokale Änderungen zu überschreiben.
    if ahead == 0 {
        emit_step(app, op, "Dateien aktualisieren", None);
        return match git.run(repo, &["merge", "--ff-only", "--no-autostash", "origin/main"]) {
            Ok(_) => Ok(None),
            Err(e) if e.contains("overwritten") => {
                let files: Vec<String> = e
                    .lines()
                    .map(str::trim)
                    .filter(|l| !l.is_empty() && !l.contains(' ') && !l.ends_with(':') && !l.ends_with('.'))
                    .map(str::to_string)
                    .collect();
                Err(format!(
                    "Du hast Dateien geändert, die auch dein Team geändert hat{}. Es wurde nichts überschrieben.\n\nLade deine Änderungen zuerst hoch (dann kannst du pro Datei entscheiden) oder verwirf sie.",
                    if files.is_empty() { String::new() } else { format!(": {}", files.join(", ")) }
                ))
            }
            Err(e) => Err(e),
        };
    }

    // 2b) Eigene Commits + Team-Commits: Rebase. Übrige lokale Änderungen vorher benannt sichern.
    let stashed = if is_dirty(st, repo)? {
        emit_step(app, op, "Lokale Änderungen sichern", None);
        git.run(repo, &["stash", "push", "-u", "-m", STASH_MARK])?;
        true
    } else {
        false
    };
    emit_step(app, op, "Änderungen zusammenführen", None);
    let res = git.run(repo, &["rebase", "--no-autostash", "origin/main"]);
    let conflicts = conflicts_now(st, repo);
    if !conflicts.is_empty() {
        return Ok(Some(SyncResult {
            result: "conflict".into(),
            conflicts,
            message: "Einige Dateien wurden von euch beiden geändert. Entscheide pro Datei, welche Version bleibt.".into(),
        }));
    }
    if let Err(e) = res {
        if rebase_in_progress(repo) {
            let _ = git.run(repo, &["rebase", "--abort"]);
        }
        if stashed {
            let _ = restore_our_stash(st, repo);
        }
        return Err(e);
    }
    if stashed {
        return restore_our_stash(st, repo);
    }
    Ok(None)
}

#[tauri::command]
pub async fn pull_changes(app: AppHandle, force: bool) -> Res<SyncResult> {
    blocking(move || {
        let st = app.state::<AppState>();
        if !force && unreal_running() {
            return Err("UNREAL_RUNNING".into());
        }
        let _busy = BusyGuard::acquire(&st, "Änderungen holen")?;
        let repo = repo_of(&app)?;
        if let Some(conflict) = integrate_remote(&app, &st, &repo, "pull")? {
            return Ok(conflict);
        }
        let _ = locks::fetch_locks(&st, &repo);
        Ok(SyncResult { result: "done".into(), conflicts: vec![], message: "Du bist auf dem neuesten Stand.".into() })
    })
    .await
}

fn push_and_unlock(app: &AppHandle, st: &AppState, repo: &Path, op: &str, unlock: &[String]) -> Res<()> {
    emit_step(app, op, "Hochladen", Some(0.0));
    st.git()
        .run_stream(repo, &["push", "--progress", "-u", "origin", "HEAD:main"], &[], progress_cb(app, op, "Hochladen"))?;
    if !unlock.is_empty() {
        emit_step(app, op, "Sperren freigeben", None);
        let my_locks: Vec<String> = locks::fetch_locks(st, repo)
            .unwrap_or_default()
            .into_iter()
            .filter(|l| l.ours && unlock.contains(&l.path))
            .map(|l| l.path)
            .collect();
        let _ = locks::unlock_paths(st, repo, &my_locks, false);
        let _ = locks::fetch_locks(st, repo);
        let _ = app.emit("locks-changed", ());
    }
    Ok(())
}

#[tauri::command]
pub async fn upload_changes(app: AppHandle, paths: Vec<String>, message: String, keep_locks: bool) -> Res<SyncResult> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Hochladen")?;
        let repo = repo_of(&app)?;
        let git = st.git();
        let op = "upload";

        if !paths.is_empty() {
            let msg = message.trim();
            if msg.is_empty() {
                return Err("Bitte kurz beschreiben, was du geändert hast".into());
            }
            emit_step(&app, op, "Änderungen verpacken", None);
            let list = std::env::temp_dir().join(format!("unrealsync-paths-{}.txt", std::process::id()));
            std::fs::write(&list, paths.join("\0")).map_err(|e| e.to_string())?;
            let list_s = list.to_string_lossy().into_owned();
            let _ = git.run(&repo, &["reset", "-q"]);
            let add = git.run(&repo, &["add", "-A", "--pathspec-from-file", &list_s, "--pathspec-file-nul"]);
            let _ = std::fs::remove_file(&list);
            add?;
            git.run(&repo, &["commit", "-m", msg])?;
        }

        if let Some(conflict) = integrate_remote(&app, &st, &repo, op)? {
            return Ok(conflict);
        }
        let unlock = if keep_locks { vec![] } else { paths.clone() };
        push_and_unlock(&app, &st, &repo, op, &unlock)?;
        Ok(SyncResult { result: "done".into(), conflicts: vec![], message: "Hochgeladen! Dein Team sieht die Änderungen jetzt.".into() })
    })
    .await
}

/// keep = "mine" | "theirs"
#[tauri::command]
pub async fn resolve_conflict(app: AppHandle, path: String, keep: String) -> Res<Vec<String>> {
    blocking(move || {
        let st = app.state::<AppState>();
        let repo = repo_of(&app)?;
        let git = st.git();
        // Beim Rebase und beim Zurückspielen der Sicherung ist "--theirs" die eigene Version.
        let side = if keep == "mine" { "--theirs" } else { "--ours" };
        match git.run(&repo, &["checkout", side, "--", &path]) {
            Ok(_) => {
                git.run(&repo, &["add", "--", &path])?;
            }
            Err(_) => {
                // Die gewählte Seite hat die Datei gelöscht
                git.run(&repo, &["rm", "-q", "--", &path])?;
            }
        }
        Ok(conflicts_now(&st, &repo))
    })
    .await
}

#[tauri::command]
pub async fn continue_after_conflicts(app: AppHandle) -> Res<SyncResult> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Zusammenführen")?;
        let repo = repo_of(&app)?;
        let git = st.git();
        if !conflicts_now(&st, &repo).is_empty() {
            return Err("Es gibt noch ungelöste Dateien".into());
        }
        if rebase_in_progress(&repo) {
            let res = git.run(&repo, &["-c", "core.editor=true", "rebase", "--continue"]);
            let conflicts = conflicts_now(&st, &repo);
            if !conflicts.is_empty() {
                return Ok(SyncResult { result: "conflict".into(), conflicts, message: "Weitere Dateien müssen entschieden werden.".into() });
            }
            res?;
            if let Some(conflict) = restore_our_stash(&st, &repo)? {
                return Ok(conflict);
            }
        } else {
            // Konflikt beim Zurückspielen der Sicherung gelöst -> Sicherung entfernen, Änderungen bleiben lokal
            let _ = git.run(&repo, &["reset", "-q"]);
            let top = git.run(&repo, &["stash", "list", "-n1", "--format=%s"]).unwrap_or_default();
            if top.contains(STASH_MARK) {
                let _ = git.run(&repo, &["stash", "drop"]);
            }
        }
        let status = read_status(&st, &repo)?;
        if status.ahead > 0 {
            push_and_unlock(&app, &st, &repo, "upload", &[])?;
            return Ok(SyncResult { result: "done".into(), conflicts: vec![], message: "Zusammengeführt und hochgeladen.".into() });
        }
        Ok(SyncResult { result: "done".into(), conflicts: vec![], message: "Zusammengeführt.".into() })
    })
    .await
}

#[tauri::command]
pub async fn abort_sync(app: AppHandle) -> Res<()> {
    blocking(move || {
        let st = app.state::<AppState>();
        let repo = repo_of(&app)?;
        if rebase_in_progress(&repo) {
            st.git().run(&repo, &["rebase", "--abort"])?;
            restore_our_stash(&st, &repo)?;
        }
        Ok(())
    })
    .await
}

/// Lokale Änderungen verwerfen (zurück auf den letzten Stand).
#[tauri::command]
pub async fn discard_changes(app: AppHandle, paths: Vec<String>) -> Res<()> {
    blocking(move || {
        let st = app.state::<AppState>();
        let _busy = BusyGuard::acquire(&st, "Verwerfen")?;
        let repo = repo_of(&app)?;
        let git = st.git();
        for p in &paths {
            let tracked = git.run(&repo, &["cat-file", "-e", &format!("HEAD:{p}")]).is_ok();
            if tracked {
                git.run(&repo, &["restore", "--source=HEAD", "--staged", "--worktree", "--", p])?;
            } else {
                let _ = git.run(&repo, &["rm", "-q", "--cached", "--ignore-unmatch", "--", p]);
                let full = repo.join(p);
                if full.exists() {
                    std::fs::remove_file(&full).map_err(|e| format!("{p}: {e}"))?;
                }
            }
        }
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn get_history(app: AppHandle, limit: Option<u32>) -> Res<Vec<CommitInfo>> {
    blocking(move || {
        let st = app.state::<AppState>();
        let repo = repo_of(&app)?;
        let n = format!("-n{}", limit.unwrap_or(80));
        let out = st.git().run(&repo, &["log", &n, "--name-status", LOG_FMT])?;
        Ok(parse_log(&out))
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_assets() {
        assert_eq!(classify("Content/Maps/Level1.umap"), ("map".into(), Some("/Game/Maps/Level1".into())));
        assert_eq!(
            classify("Plugins/MyPlug/Content/UI/W_Main.uasset"),
            ("asset".into(), Some("/MyPlug/UI/W_Main".into()))
        );
        assert_eq!(classify("Source/Game/Player.cpp").0, "code");
    }

    #[test]
    fn log_parsing() {
        let out = "\u{1e}abc\u{1f}a\u{1f}Chris\u{1f}2026-01-01T00:00:00+01:00\u{1f}Neues Level\n\nA\tContent/Maps/L.umap\nM\tConfig/DefaultGame.ini\n";
        let l = parse_log(out);
        assert_eq!(l.len(), 1);
        assert_eq!(l[0].files.len(), 2);
        assert_eq!(l[0].message, "Neues Level");
    }
}

#[cfg(test)]
mod integrate_tests {
    use super::*;
    use crate::git::Git;
    use crate::settings::Settings;
    use crate::state::NoEmit;

    struct Env {
        st: AppState,
        dir: PathBuf,
        git: Git,
    }

    impl Env {
        fn new(name: &str) -> Self {
            let dir = std::env::temp_dir().join(format!("unrealsync-int-{name}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(&dir).unwrap();
            let st = AppState {
                settings: parking_lot::Mutex::new(Settings::default()),
                settings_path: dir.join("settings.json"),
                resource_dir: None,
                busy: Default::default(),
                locks: Default::default(),
                watcher: Default::default(),
            };
            let git = Git::locate(None);
            git.run(&dir, &["init", "-q", "--bare", "-b", "main", "remote.git"]).unwrap();
            for r in ["a", "b"] {
                git.run(&dir, &["clone", "-q", "remote.git", r]).unwrap();
                let p = dir.join(r);
                git.run(&p, &["config", "user.name", r]).unwrap();
                git.run(&p, &["config", "user.email", "t@t"]).unwrap();
                git.run(&p, &["config", "core.autocrlf", "false"]).unwrap();
            }
            let e = Self { st, dir, git };
            e.commit("a", "base.txt", "base");
            e.git.run(&e.p("a"), &["push", "-q", "-u", "origin", "main"]).unwrap();
            e.git.run(&e.p("b"), &["pull", "-q", "origin", "main"]).unwrap();
            e
        }
        fn p(&self, r: &str) -> PathBuf {
            self.dir.join(r)
        }
        fn write(&self, r: &str, f: &str, c: &str) {
            std::fs::write(self.p(r).join(f), c).unwrap();
        }
        fn read(&self, r: &str, f: &str) -> String {
            std::fs::read_to_string(self.p(r).join(f)).unwrap_or_default()
        }
        fn commit(&self, r: &str, f: &str, c: &str) {
            self.write(r, f, c);
            self.git.run(&self.p(r), &["add", "-A"]).unwrap();
            self.git.run(&self.p(r), &["commit", "-qm", f]).unwrap();
        }
        fn team_pushes(&self, f: &str, c: &str) {
            self.git.run(&self.p("b"), &["pull", "-q", "--rebase", "origin", "main"]).unwrap();
            self.commit("b", f, c);
            self.git.run(&self.p("b"), &["push", "-q", "origin", "HEAD:main"]).unwrap();
        }
        fn integrate(&self) -> Res<Option<SyncResult>> {
            integrate_remote(&NoEmit, &self.st, &self.p("a"), "test")
        }
        fn stashes(&self) -> String {
            self.git.run(&self.p("a"), &["stash", "list"]).unwrap()
        }
    }

    impl Drop for Env {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn fast_forward_keeps_unrelated_local_changes() {
        let e = Env::new("ff");
        e.write("a", "base.txt", "meine lokale Arbeit");
        e.write("a", "neu.txt", "neue lokale Datei");
        e.team_pushes("team.txt", "vom Team");
        assert!(e.integrate().unwrap().is_none());
        assert_eq!(e.read("a", "team.txt"), "vom Team");
        assert_eq!(e.read("a", "base.txt"), "meine lokale Arbeit");
        assert_eq!(e.read("a", "neu.txt"), "neue lokale Datei");
        assert!(e.stashes().trim().is_empty());
    }

    #[test]
    fn fast_forward_never_overwrites_overlapping_changes() {
        let e = Env::new("overlap");
        e.write("a", "base.txt", "meine lokale Arbeit");
        e.team_pushes("base.txt", "Team hat base geändert");
        let err = e.integrate().unwrap_err();
        assert!(err.contains("nichts überschrieben"), "{err}");
        assert!(err.contains("base.txt"), "{err}");
        assert_eq!(e.read("a", "base.txt"), "meine lokale Arbeit");
    }

    #[test]
    fn rebase_with_dirty_tree_restores_local_changes() {
        let e = Env::new("rebase");
        e.commit("a", "meins.txt", "mein Commit");
        e.write("a", "base.txt", "noch nicht hochgeladen");
        e.write("a", "untracked.txt", "neu");
        e.team_pushes("team.txt", "vom Team");
        assert!(e.integrate().unwrap().is_none());
        assert_eq!(e.read("a", "team.txt"), "vom Team");
        assert_eq!(e.read("a", "meins.txt"), "mein Commit");
        assert_eq!(e.read("a", "base.txt"), "noch nicht hochgeladen");
        assert_eq!(e.read("a", "untracked.txt"), "neu");
        assert!(e.stashes().trim().is_empty(), "Sicherung wurde nicht zurückgespielt");
        assert_eq!(count(&e.st, &e.p("a"), "origin/main..HEAD"), 1);
    }

    #[test]
    fn conflicting_commits_report_conflict_and_keep_backup() {
        let e = Env::new("conflict");
        e.commit("a", "base.txt", "meine Version");
        e.write("a", "lokal.txt", "ungesichert");
        e.team_pushes("base.txt", "Team-Version");
        let r = e.integrate().unwrap().expect("Konflikt erwartet");
        assert_eq!(r.result, "conflict");
        assert_eq!(r.conflicts, vec!["base.txt".to_string()]);
        // Ungesicherte Arbeit liegt benannt in der Sicherung, nicht verloren
        assert!(e.stashes().contains(STASH_MARK));
        // Abbrechen stellt alles wieder her
        e.git.run(&e.p("a"), &["rebase", "--abort"]).unwrap();
        restore_our_stash(&e.st, &e.p("a")).unwrap();
        assert_eq!(e.read("a", "base.txt"), "meine Version");
        assert_eq!(e.read("a", "lokal.txt"), "ungesichert");
    }
}
