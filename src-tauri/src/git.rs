//! Dünne Hülle um git / git-lfs. Alle Aufrufe laufen ohne Konsolenfenster,
//! Zugangsdaten werden per Umgebungsvariable (nicht über die Kommandozeile) übergeben.

use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Clone, Default)]
pub struct Git {
    pub exe: PathBuf,
    pub extra_path: Vec<PathBuf>,
    /// (URL-Präfix, Authorization-Header-Wert)
    pub auth: Option<(String, String)>,
}

#[derive(Clone, Debug, serde::Serialize)]
pub struct Progress {
    pub message: String,
    pub percent: Option<f32>,
}

pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

impl Output {
    pub fn into_result(self) -> Result<String, String> {
        if self.ok {
            Ok(self.stdout)
        } else {
            Err(clean_error(&self.stderr, &self.stdout))
        }
    }
}

static TMP_COUNTER: AtomicU64 = AtomicU64::new(0);

impl Git {
    /// Sucht das mitgelieferte MinGit im Ressourcen-Ordner, sonst System-Git.
    pub fn locate(resource_dir: Option<&Path>) -> Self {
        if let Some(res) = resource_dir {
            let root = res.join("resources").join("mingit");
            let exe = root.join("cmd").join("git.exe");
            if exe.exists() {
                return Self {
                    exe,
                    extra_path: vec![
                        root.join("mingw64").join("bin"),
                        root.join("usr").join("bin"),
                        root.join("cmd"),
                    ],
                    auth: None,
                };
            }
        }
        Self { exe: PathBuf::from("git"), extra_path: vec![], auth: None }
    }

    pub fn with_auth(mut self, url_prefix: &str, header: String) -> Self {
        let mut prefix = url_prefix.trim_end_matches('/').to_string();
        prefix.push('/');
        self.auth = Some((prefix, header));
        self
    }

    pub fn command(&self, cwd: Option<&Path>, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.exe);
        cmd.args(args);
        if let Some(cwd) = cwd {
            cmd.current_dir(cwd);
        }
        if !self.extra_path.is_empty() {
            let mut paths: Vec<PathBuf> = self.extra_path.clone();
            if let Some(p) = std::env::var_os("PATH") {
                paths.extend(std::env::split_paths(&p));
            }
            if let Ok(joined) = std::env::join_paths(paths) {
                cmd.env("PATH", joined);
            }
        }
        cmd.env("GIT_TERMINAL_PROMPT", "0")
            .env("GCM_INTERACTIVE", "never")
            .env("GIT_EDITOR", "true");

        let mut cfg: Vec<(String, String)> = vec![
            ("core.quotepath".into(), "false".into()),
            ("core.longpaths".into(), "true".into()),
        ];
        if let Some((prefix, header)) = &self.auth {
            // Keine Credential-Helper-Popups: wir liefern den Token selbst.
            cfg.push(("credential.helper".into(), String::new()));
            cfg.push((format!("http.{prefix}.extraheader"), format!("Authorization: {header}")));
        }
        cmd.env("GIT_CONFIG_COUNT", cfg.len().to_string());
        for (i, (k, v)) in cfg.iter().enumerate() {
            cmd.env(format!("GIT_CONFIG_KEY_{i}"), k);
            cmd.env(format!("GIT_CONFIG_VALUE_{i}"), v);
        }
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd
    }

    pub fn output(&self, cwd: &Path, args: &[&str]) -> Result<Output, String> {
        let out = self
            .command(Some(cwd), args)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("Git konnte nicht gestartet werden ({e}). Ist Git installiert?"))?;
        Ok(Output {
            ok: out.status.success(),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }

    /// Führt git aus und liefert stdout; Fehler enthalten die Git-Meldung.
    pub fn run(&self, cwd: &Path, args: &[&str]) -> Result<String, String> {
        self.output(cwd, args)?.into_result()
    }

    pub fn version(&self) -> Result<String, String> {
        let out = self
            .command(None, &["--version"])
            .output()
            .map_err(|e| format!("Git nicht gefunden: {e}"))?;
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    }

    /// Lange Operationen (clone, push, pull …): Fortschritt aus Git und Git LFS wird gestreamt.
    pub fn run_stream(
        &self,
        cwd: &Path,
        args: &[&str],
        extra_env: &[(&str, &str)],
        mut on_progress: impl FnMut(Progress),
    ) -> Result<String, String> {
        let lfs_log = std::env::temp_dir().join(format!(
            "unrealsync-lfs-{}-{}.log",
            std::process::id(),
            TMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = std::fs::write(&lfs_log, "");

        let mut cmd = self.command(Some(cwd), args);
        cmd.env("GIT_LFS_PROGRESS", &lfs_log);
        for (k, v) in extra_env {
            cmd.env(k, v);
        }
        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Git konnte nicht gestartet werden ({e})"))?;

        let (tx, rx) = mpsc::channel::<Progress>();

        // stdout sammeln
        let mut stdout = child.stdout.take().unwrap();
        let out_handle = std::thread::spawn(move || {
            let mut s = String::new();
            let _ = stdout.read_to_string(&mut s);
            s
        });

        // stderr: Git-Fortschritt (mit \r getrennt)
        let stderr = child.stderr.take().unwrap();
        let tx_err = tx.clone();
        let err_handle = std::thread::spawn(move || {
            let mut all = String::new();
            let mut reader = BufReader::new(stderr);
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            while let Ok(1) = reader.read(&mut byte) {
                if byte[0] == b'\r' || byte[0] == b'\n' {
                    if !buf.is_empty() {
                        let line = String::from_utf8_lossy(&buf).into_owned();
                        if let Some(p) = parse_git_progress(&line) {
                            let _ = tx_err.send(p);
                        }
                        if byte[0] == b'\n' {
                            all.push_str(&line);
                            all.push('\n');
                        }
                        buf.clear();
                    }
                } else {
                    buf.push(byte[0]);
                }
            }
            if !buf.is_empty() {
                all.push_str(&String::from_utf8_lossy(&buf));
            }
            all
        });

        // Git-LFS-Fortschrittsdatei mitlesen
        let stop = Arc::new(AtomicBool::new(false));
        let stop2 = stop.clone();
        let log2 = lfs_log.clone();
        let lfs_handle = std::thread::spawn(move || {
            let mut pos = 0u64;
            let mut pending = String::new();
            loop {
                let done = stop2.load(Ordering::Relaxed);
                if let Ok(mut f) = std::fs::File::open(&log2) {
                    if f.seek(SeekFrom::Start(pos)).is_ok() {
                        let mut chunk = String::new();
                        if let Ok(n) = f.read_to_string(&mut chunk) {
                            pos += n as u64;
                            pending.push_str(&chunk);
                            while let Some(idx) = pending.find('\n') {
                                let line: String = pending.drain(..=idx).collect();
                                if let Some(p) = parse_lfs_progress(line.trim()) {
                                    let _ = tx.send(p);
                                }
                            }
                        }
                    }
                }
                if done {
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
        });

        // Fortschritt weiterreichen, bis Git fertig ist
        let status = loop {
            while let Ok(p) = rx.try_recv() {
                on_progress(p);
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                Err(e) => return Err(e.to_string()),
            }
        };
        stop.store(true, Ordering::Relaxed);
        let stdout = out_handle.join().unwrap_or_default();
        let stderr = err_handle.join().unwrap_or_default();
        let _ = lfs_handle.join();
        while let Ok(p) = rx.try_recv() {
            on_progress(p);
        }
        let _ = std::fs::remove_file(&lfs_log);

        if status.success() {
            Ok(stdout)
        } else {
            Err(clean_error(&stderr, &stdout))
        }
    }
}

fn parse_percent(line: &str) -> Option<f32> {
    let idx = line.find('%')?;
    let head = &line[..idx];
    let start = head.rfind(|c: char| !c.is_ascii_digit()).map(|i| i + 1).unwrap_or(0);
    head[start..].parse::<f32>().ok()
}

fn parse_git_progress(line: &str) -> Option<Progress> {
    const LABELS: &[(&str, &str)] = &[
        ("Enumerating objects", "Zähle Dateien"),
        ("Counting objects", "Zähle Dateien"),
        ("Compressing objects", "Komprimiere"),
        ("Writing objects", "Sende Daten"),
        ("Receiving objects", "Empfange Daten"),
        ("Resolving deltas", "Verarbeite Daten"),
        ("Updating files", "Aktualisiere Dateien"),
        ("Uploading LFS objects", "Lade große Dateien hoch"),
        ("Downloading LFS objects", "Lade große Dateien herunter"),
        ("Filtering content", "Lade große Dateien herunter"),
    ];
    let line = line.trim().trim_start_matches("remote: ");
    for (en, de) in LABELS {
        if line.starts_with(en) {
            return Some(Progress { message: de.to_string(), percent: parse_percent(line) });
        }
    }
    None
}

/// Format: "<direction> <i>/<n> <bytes>/<total> <name>"
fn parse_lfs_progress(line: &str) -> Option<Progress> {
    let mut parts = line.splitn(4, ' ');
    let dir = parts.next()?;
    let files = parts.next()?;
    let bytes = parts.next()?;
    let name = parts.next().unwrap_or("");
    let (i, n) = files.split_once('/')?;
    let (b, t) = bytes.split_once('/')?;
    let (i, n): (f32, f32) = (i.parse().ok()?, n.parse().ok()?);
    let (b, t): (f32, f32) = (b.parse().ok()?, t.parse().ok()?);
    let file_frac = if t > 0.0 { b / t } else { 1.0 };
    let percent = if n > 0.0 { ((i - 1.0 + file_frac) / n * 100.0).clamp(0.0, 100.0) } else { 0.0 };
    let verb = match dir {
        "upload" => "Hochladen",
        "download" => "Herunterladen",
        _ => "Übertrage",
    };
    let short = name.rsplit('/').next().unwrap_or(name);
    Some(Progress {
        message: format!("{verb} {} von {}: {short}", i as u64, n as u64),
        percent: Some(percent),
    })
}

/// Macht Git-Fehlermeldungen etwas verständlicher.
pub fn clean_error(stderr: &str, stdout: &str) -> String {
    let text = if stderr.trim().is_empty() { stdout } else { stderr };
    let lines: Vec<&str> = text
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with("hint:"))
        .collect();
    let joined = lines.join("\n");
    let lower = joined.to_lowercase();
    if lower.contains("authentication failed") || lower.contains("403") && lower.contains("denied") {
        return format!("Anmeldung abgelehnt – bitte in den Einstellungen neu anmelden.\n\n{joined}");
    }
    if lower.contains("could not resolve host") || lower.contains("unable to access") {
        return format!("Keine Verbindung zum Server. Bist du online?\n\n{joined}");
    }
    if lower.contains("exceeded") && lower.contains("lfs") || lower.contains("over its data quota") || lower.contains("budget") {
        return format!(
            "Das LFS-Kontingent ist aufgebraucht. Unter „Speicher“ kannst du auf einen eigenen Cloud-Speicher umziehen oder bei GitHub ein Budget freigeben.\n\n{joined}"
        );
    }
    if lower.contains("locked by") || lower.contains("lock") && lower.contains("owned by") {
        return format!("Eine Datei ist von jemand anderem gesperrt.\n\n{joined}");
    }
    if joined.is_empty() {
        "Unbekannter Git-Fehler".into()
    } else {
        joined
    }
}

/// Zeilen eines Befehls-Outputs, leere entfernt.
pub fn lines(s: &str) -> Vec<String> {
    s.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn git_progress_lines() {
        let p = parse_git_progress("Receiving objects:  45% (9/20), 1.2 MiB").unwrap();
        assert_eq!(p.message, "Empfange Daten");
        assert_eq!(p.percent, Some(45.0));
        assert!(parse_git_progress("hint: foo").is_none());
    }

    #[test]
    fn lfs_progress_lines() {
        let p = parse_lfs_progress("download 2/4 50/100 Content/Maps/L1.umap").unwrap();
        assert_eq!(p.percent, Some(37.5));
        assert!(p.message.contains("L1.umap"));
    }

    #[test]
    fn auth_header_via_env_and_streaming() {
        let dir = std::env::temp_dir().join(format!("unrealsync-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let git = Git::locate(None).with_auth("https://github.com", "Basic abc".into());
        git.run(&dir, &["init", "-q", "-b", "main", "src"]).unwrap();
        let src = dir.join("src");
        // Token-Header kommt über GIT_CONFIG_* an, nicht über die Kommandozeile
        let h = git.run(&src, &["config", "--get", "http.https://github.com/.extraheader"]).unwrap();
        assert_eq!(h.trim(), "Authorization: Basic abc");
        std::fs::write(src.join("a.txt"), "x").unwrap();
        git.run(&src, &["add", "."]).unwrap();
        git.run(&src, &["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "c"]).unwrap();
        let mut seen = 0;
        git.run_stream(&dir, &["clone", "--progress", "src", "dst"], &[], |_| seen += 1).unwrap();
        assert!(dir.join("dst").join("a.txt").exists());
        let err = git.run(&dir, &["rev-parse", "--verify", "nope"]).unwrap_err();
        assert!(!err.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
