use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AccountKind {
    Github,
    Server,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub kind: AccountKind,
    /// "https://github.com" oder Basis-URL des eigenen Git-Servers (ohne Slash am Ende)
    pub base_url: String,
    pub login: String,
    pub name: String,
    pub email: String,
    pub avatar_url: Option<String>,
}

impl Account {
    pub fn token_key(&self) -> String {
        format!("account:{}:{}", self.base_url, self.login)
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub name: String,
    pub path: String,
    pub remote_url: String,
    /// "owner/repo" bei GitHub-Projekten
    pub github_repo: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub account: Option<Account>,
    pub projects: Vec<Project>,
    pub active_project: Option<String>,
    pub auto_lock: bool,
    pub close_to_tray: bool,
    pub github_client_id: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            account: None,
            projects: vec![],
            active_project: None,
            auto_lock: true,
            close_to_tray: true,
            github_client_id: None,
        }
    }
}

impl Settings {
    pub fn load(path: &Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        std::fs::write(path, json).map_err(|e| format!("Einstellungen speichern fehlgeschlagen: {e}"))
    }

    pub fn active(&self) -> Option<&Project> {
        let active = self.active_project.as_ref()?;
        self.projects.iter().find(|p| &p.path == active)
    }

    pub fn upsert_project(&mut self, project: Project) {
        self.projects.retain(|p| p.path != project.path);
        self.active_project = Some(project.path.clone());
        self.projects.push(project);
    }

    pub fn github_client_id(&self) -> Option<String> {
        self.github_client_id
            .clone()
            .filter(|s| !s.trim().is_empty())
            .or_else(|| option_env!("UNREALSYNC_GITHUB_CLIENT_ID").map(str::to_string))
    }
}

pub fn project_path(p: &Project) -> PathBuf {
    PathBuf::from(&p.path)
}

pub mod secrets {
    const SERVICE: &str = "UnrealSync";

    pub fn set(key: &str, value: &str) -> Result<(), String> {
        keyring::Entry::new(SERVICE, key)
            .and_then(|e| e.set_password(value))
            .map_err(|e| format!("Windows-Anmeldeinformationen: {e}"))
    }

    pub fn get(key: &str) -> Option<String> {
        keyring::Entry::new(SERVICE, key).ok()?.get_password().ok()
    }

    pub fn delete(key: &str) {
        if let Ok(e) = keyring::Entry::new(SERVICE, key) {
            let _ = e.delete_credential();
        }
    }
}
