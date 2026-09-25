//! GitHub-Anmeldung (Device Flow / Token) und REST-API.

use crate::settings::{secrets, Account, AccountKind};
use crate::state::{blocking, AppState, Res};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const API: &str = "https://api.github.com";

fn client() -> reqwest::blocking::Client {
    reqwest::blocking::Client::builder()
        .user_agent("UnrealSync")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .expect("HTTP-Client")
}

pub struct Gh {
    token: String,
    http: reqwest::blocking::Client,
}

impl Gh {
    pub fn new(token: &str) -> Self {
        Self { token: token.to_string(), http: client() }
    }

    fn req(&self, method: reqwest::Method, path: &str) -> reqwest::blocking::RequestBuilder {
        self.http
            .request(method, format!("{API}{path}"))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(&self.token)
    }

    fn send(&self, rb: reqwest::blocking::RequestBuilder) -> Res<Value> {
        let resp = rb.send().map_err(|e| format!("GitHub nicht erreichbar: {e}"))?;
        let status = resp.status();
        let text = resp.text().unwrap_or_default();
        if !status.is_success() {
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| {
                    let base = v["message"].as_str()?.to_string();
                    let detail = v["errors"][0]["message"].as_str().map(|d| format!(" – {d}")).unwrap_or_default();
                    Some(base + &detail)
                })
                .unwrap_or(text);
            return Err(match status.as_u16() {
                401 => "GitHub-Anmeldung ungültig – bitte neu anmelden".into(),
                s => format!("GitHub-Fehler {s}: {msg}"),
            });
        }
        Ok(if text.is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::Null) })
    }

    pub fn get(&self, path: &str) -> Res<Value> {
        self.send(self.req(reqwest::Method::GET, path))
    }

    pub fn user(&self) -> Res<Account> {
        let u = self.get("/user")?;
        let login = u["login"].as_str().ok_or("Unerwartete Antwort von GitHub")?.to_string();
        let id = u["id"].as_u64().unwrap_or(0);
        Ok(Account {
            kind: AccountKind::Github,
            base_url: "https://github.com".into(),
            name: u["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(&login).to_string(),
            email: format!("{id}+{login}@users.noreply.github.com"),
            avatar_url: u["avatar_url"].as_str().map(str::to_string),
            login,
        })
    }

    pub fn create_repo(&self, name: &str, private: bool) -> Res<RemoteRepo> {
        let v = self.send(self.req(reqwest::Method::POST, "/user/repos").json(&json!({
            "name": name,
            "private": private,
            "auto_init": false,
            "description": "Unreal-Projekt – verwaltet mit UnrealSync",
        })))?;
        Ok(RemoteRepo::from(&v))
    }

    pub fn add_collaborator(&self, repo: &str, user: &str) -> Res<()> {
        self.send(
            self.req(reqwest::Method::PUT, &format!("/repos/{repo}/collaborators/{user}"))
                .json(&json!({"permission": "push"})),
        )?;
        Ok(())
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRepo {
    pub full_name: String,
    pub name: String,
    pub clone_url: String,
    pub html_url: String,
    pub private: bool,
    pub owner: String,
    pub updated_at: String,
    pub size_kb: u64,
}

impl From<&Value> for RemoteRepo {
    fn from(v: &Value) -> Self {
        Self {
            full_name: v["full_name"].as_str().unwrap_or_default().into(),
            name: v["name"].as_str().unwrap_or_default().into(),
            clone_url: v["clone_url"].as_str().unwrap_or_default().into(),
            html_url: v["html_url"].as_str().unwrap_or_default().into(),
            private: v["private"].as_bool().unwrap_or(true),
            owner: v["owner"]["login"].as_str().unwrap_or_default().into(),
            updated_at: v["pushed_at"].as_str().or(v["updated_at"].as_str()).unwrap_or_default().into(),
            size_kb: v["size"].as_u64().unwrap_or(0),
        }
    }
}

fn gh(app: &AppHandle) -> Res<Gh> {
    let st = app.state::<AppState>();
    let (acc, token) = st.account()?;
    if acc.kind != AccountKind::Github {
        return Err("Diese Funktion gibt es nur mit einem GitHub-Konto".into());
    }
    Ok(Gh::new(&token))
}

fn store_account(app: &AppHandle, acc: Account, token: &str) -> Res<Account> {
    secrets::set(&acc.token_key(), token)?;
    let st = app.state::<AppState>();
    if let Some(old) = st.settings().account {
        if old.token_key() != acc.token_key() {
            secrets::delete(&old.token_key());
        }
    }
    st.update_settings(|s| s.account = Some(acc.clone()))?;
    Ok(acc)
}

// ---------------------------------------------------------------- Commands

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub interval: u64,
    pub expires_in: u64,
}

#[tauri::command]
pub async fn github_device_start(app: AppHandle) -> Res<DeviceCode> {
    blocking(move || {
        let client_id = app
            .state::<AppState>()
            .settings()
            .github_client_id()
            .ok_or("NO_CLIENT_ID")?;
        let v: Value = client()
            .post("https://github.com/login/device/code")
            .header("Accept", "application/json")
            .form(&[("client_id", client_id.as_str()), ("scope", "repo read:user")])
            .send()
            .and_then(|r| r.json())
            .map_err(|e| format!("GitHub nicht erreichbar: {e}"))?;
        if let Some(err) = v["error_description"].as_str() {
            return Err(format!("GitHub: {err}"));
        }
        Ok(DeviceCode {
            device_code: v["device_code"].as_str().unwrap_or_default().into(),
            user_code: v["user_code"].as_str().unwrap_or_default().into(),
            verification_uri: v["verification_uri"].as_str().unwrap_or("https://github.com/login/device").into(),
            interval: v["interval"].as_u64().unwrap_or(5),
            expires_in: v["expires_in"].as_u64().unwrap_or(900),
        })
    })
    .await
}

/// Liefert `None`, solange der Nutzer noch nicht bestätigt hat.
#[tauri::command]
pub async fn github_device_poll(app: AppHandle, device_code: String) -> Res<Option<Account>> {
    blocking(move || {
        let client_id = app.state::<AppState>().settings().github_client_id().ok_or("NO_CLIENT_ID")?;
        let v: Value = client()
            .post("https://github.com/login/oauth/access_token")
            .header("Accept", "application/json")
            .form(&[
                ("client_id", client_id.as_str()),
                ("device_code", device_code.as_str()),
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ])
            .send()
            .and_then(|r| r.json())
            .map_err(|e| format!("GitHub nicht erreichbar: {e}"))?;
        if let Some(token) = v["access_token"].as_str() {
            let acc = Gh::new(token).user()?;
            return store_account(&app, acc, token).map(Some);
        }
        match v["error"].as_str() {
            Some("authorization_pending") | Some("slow_down") => Ok(None),
            Some("expired_token") => Err("Der Code ist abgelaufen – bitte neu starten".into()),
            Some("access_denied") => Err("Anmeldung wurde abgelehnt".into()),
            Some(other) => Err(format!("GitHub: {other}")),
            None => Ok(None),
        }
    })
    .await
}

#[tauri::command]
pub async fn github_token_login(app: AppHandle, token: String) -> Res<Account> {
    blocking(move || {
        let token = token.trim().to_string();
        let acc = Gh::new(&token).user()?;
        store_account(&app, acc, &token)
    })
    .await
}

/// Eigener Git-Server (Forgejo/Gitea/GitLab …): Zugangsdaten werden beim ersten Git-Zugriff geprüft.
#[tauri::command]
pub async fn server_login(app: AppHandle, base_url: String, login: String, token: String, email: Option<String>) -> Res<Account> {
    blocking(move || {
        let base = base_url.trim().trim_end_matches('/').to_string();
        if !base.starts_with("https://") && !base.starts_with("http://") {
            return Err("Die Server-Adresse muss mit https:// beginnen".into());
        }
        let login = login.trim().to_string();
        let acc = Account {
            kind: AccountKind::Server,
            base_url: base,
            name: login.clone(),
            email: email.filter(|e| !e.trim().is_empty()).unwrap_or_else(|| format!("{login}@unrealsync.local")),
            avatar_url: None,
            login,
        };
        store_account(&app, acc, token.trim())
    })
    .await
}

#[tauri::command]
pub async fn logout(app: AppHandle) -> Res<()> {
    let st = app.state::<AppState>();
    if let Some(acc) = st.settings().account {
        secrets::delete(&acc.token_key());
    }
    st.update_settings(|s| s.account = None)?;
    Ok(())
}

#[tauri::command]
pub async fn github_list_repos(app: AppHandle) -> Res<Vec<RemoteRepo>> {
    blocking(move || {
        let v = gh(&app)?.get("/user/repos?affiliation=owner,collaborator&sort=pushed&per_page=100")?;
        Ok(v.as_array().map(|a| a.iter().map(RemoteRepo::from).collect()).unwrap_or_default())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Invitation {
    pub id: u64,
    pub repo: RemoteRepo,
    pub inviter: String,
}

#[tauri::command]
pub async fn github_invitations(app: AppHandle) -> Res<Vec<Invitation>> {
    blocking(move || {
        let v = gh(&app)?.get("/user/repository_invitations")?;
        Ok(v.as_array()
            .map(|a| {
                a.iter()
                    .map(|i| Invitation {
                        id: i["id"].as_u64().unwrap_or(0),
                        repo: RemoteRepo::from(&i["repository"]),
                        inviter: i["inviter"]["login"].as_str().unwrap_or_default().into(),
                    })
                    .collect()
            })
            .unwrap_or_default())
    })
    .await
}

#[tauri::command]
pub async fn github_accept_invitation(app: AppHandle, id: u64) -> Res<()> {
    blocking(move || {
        let g = gh(&app)?;
        g.send(g.req(reqwest::Method::PATCH, &format!("/user/repository_invitations/{id}")))?;
        Ok(())
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Collaborator {
    pub login: String,
    pub avatar_url: Option<String>,
    pub pending: bool,
}

#[tauri::command]
pub async fn team_members(app: AppHandle) -> Res<Vec<Collaborator>> {
    blocking(move || {
        let project = app.state::<AppState>().active_project()?;
        let Some(repo) = project.github_repo else { return Ok(vec![]) };
        let g = gh(&app)?;
        let mut out: Vec<Collaborator> = g
            .get(&format!("/repos/{repo}/collaborators?per_page=100"))?
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|c| Collaborator {
                        login: c["login"].as_str().unwrap_or_default().into(),
                        avatar_url: c["avatar_url"].as_str().map(str::to_string),
                        pending: false,
                    })
                    .collect()
            })
            .unwrap_or_default();
        // offene Einladungen (nur für Admins sichtbar – Fehler ignorieren)
        if let Ok(inv) = g.get(&format!("/repos/{repo}/invitations")) {
            for i in inv.as_array().into_iter().flatten() {
                out.push(Collaborator {
                    login: i["invitee"]["login"].as_str().unwrap_or_default().into(),
                    avatar_url: i["invitee"]["avatar_url"].as_str().map(str::to_string),
                    pending: true,
                });
            }
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
pub async fn team_invite(app: AppHandle, login: String) -> Res<()> {
    blocking(move || {
        let project = app.state::<AppState>().active_project()?;
        let repo = project.github_repo.ok_or("Mitglieder für eigene Server bitte in deren Weboberfläche einladen")?;
        gh(&app)?.add_collaborator(&repo, login.trim().trim_start_matches('@'))
    })
    .await
}
