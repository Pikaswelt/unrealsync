use crate::git::{Git, Progress};
use crate::locks::LockInfo;
use crate::settings::{secrets, Account, AccountKind, Project, Settings};
use base64::Engine;
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter};

pub struct AppState {
    pub settings: Mutex<Settings>,
    pub settings_path: PathBuf,
    pub resource_dir: Option<PathBuf>,
    pub busy: Mutex<Option<String>>,
    pub locks: Mutex<Vec<LockInfo>>,
    pub watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

pub type Res<T> = Result<T, String>;

impl AppState {
    pub fn settings(&self) -> Settings {
        self.settings.lock().clone()
    }

    pub fn update_settings(&self, f: impl FnOnce(&mut Settings)) -> Res<Settings> {
        let mut s = self.settings.lock();
        f(&mut s);
        s.save(&self.settings_path)?;
        Ok(s.clone())
    }

    pub fn account(&self) -> Res<(Account, String)> {
        let acc = self.settings.lock().account.clone().ok_or("Nicht angemeldet")?;
        let token = secrets::get(&acc.token_key()).ok_or("Anmeldung abgelaufen – bitte neu anmelden")?;
        Ok((acc, token))
    }

    pub fn active_project(&self) -> Res<Project> {
        self.settings.lock().active().cloned().ok_or_else(|| "Kein Projekt ausgewählt".to_string())
    }

    /// Git mit hinterlegtem Token für den Server des Kontos
    pub fn git(&self) -> Git {
        let git = Git::locate(self.resource_dir.as_deref());
        match self.account() {
            Ok((acc, token)) => {
                let user = match acc.kind {
                    AccountKind::Github => "x-access-token".to_string(),
                    AccountKind::Server => acc.login.clone(),
                };
                let basic = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{token}"));
                git.with_auth(&acc.base_url, format!("Basic {basic}"))
            }
            Err(_) => git,
        }
    }

    pub fn is_busy(&self) -> bool {
        self.busy.lock().is_some()
    }
}

/// Verhindert, dass zwei Git-Vorgänge gleichzeitig laufen.
pub struct BusyGuard<'a>(&'a AppState);

impl<'a> BusyGuard<'a> {
    pub fn acquire(state: &'a AppState, what: &str) -> Res<Self> {
        let mut b = state.busy.lock();
        if let Some(cur) = b.as_ref() {
            return Err(format!("Es läuft bereits ein Vorgang: {cur}"));
        }
        *b = Some(what.to_string());
        Ok(Self(state))
    }
}

impl Drop for BusyGuard<'_> {
    fn drop(&mut self) {
        *self.0.busy.lock() = None;
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpProgress {
    pub op: String,
    pub step: String,
    pub message: String,
    pub percent: Option<f32>,
}

/// Ziel für Fortschrittsmeldungen (die App oder – in Tests – nichts)
pub trait Emit {
    fn emit_progress(&self, p: OpProgress);
}

impl<R: tauri::Runtime> Emit for AppHandle<R> {
    fn emit_progress(&self, p: OpProgress) {
        let _ = self.emit("op-progress", p);
    }
}

pub struct NoEmit;

impl Emit for NoEmit {
    fn emit_progress(&self, _: OpProgress) {}
}

pub fn emit_step<E: Emit + ?Sized>(app: &E, op: &str, step: &str, percent: Option<f32>) {
    app.emit_progress(OpProgress { op: op.into(), step: step.into(), message: String::new(), percent });
}

pub fn progress_cb<'a, E: Emit + ?Sized>(app: &'a E, op: &'a str, step: &'a str) -> impl FnMut(Progress) + 'a {
    move |p: Progress| {
        app.emit_progress(OpProgress { op: op.into(), step: step.into(), message: p.message, percent: p.percent });
    }
}

pub async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Res<T> + Send + 'static) -> Res<T> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}
