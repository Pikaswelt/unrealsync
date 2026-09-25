//! Git-LFS "standalone custom transfer agent": lädt LFS-Objekte direkt in einen
//! S3-kompatiblen Speicher (z. B. Cloudflare R2), ohne eigenen LFS-Server.
//! Protokoll: https://github.com/git-lfs/git-lfs/blob/main/docs/custom-transfers.md

use crate::s3::{S3Keys, S3Location, S3};
use crate::settings::secrets;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Serialize, Deserialize)]
pub struct AgentConfig {
    pub location: S3Location,
    /// Temp-Ordner auf demselben Laufwerk wie das Repo (.git/lfs/tmp)
    pub tmp_dir: String,
}

impl AgentConfig {
    pub fn encode(&self) -> String {
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(serde_json::to_vec(self).unwrap_or_default())
    }

    fn decode(s: &str) -> Option<Self> {
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(s.trim()).ok()?;
        serde_json::from_slice(&bytes).ok()
    }
}

fn send(v: Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{v}");
    let _ = out.flush();
}

fn complete_err(oid: &str, msg: String) {
    send(json!({"event": "complete", "oid": oid, "error": {"code": 2, "message": msg}}));
}

pub fn run(encoded: &str) -> i32 {
    let Some(cfg) = AgentConfig::decode(encoded) else {
        eprintln!("UnrealSync LFS-Agent: ungültige Konfiguration");
        return 2;
    };
    let keys: Option<S3Keys> = secrets::get(&cfg.location.secret_key_name()).and_then(|s| serde_json::from_str(&s).ok());
    let client = keys.map(|k| S3::new(cfg.location.clone(), k));
    let tmp_dir = PathBuf::from(&cfg.tmp_dir);
    let _ = std::fs::create_dir_all(&tmp_dir);

    let stdin = std::io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
        let event = msg["event"].as_str().unwrap_or("");
        match event {
            "init" => {
                if client.is_none() {
                    send(json!({"error": {"code": 32, "message": "Kein Zugangsschlüssel für den Cloud-Speicher hinterlegt. Öffne UnrealSync und gib den Einladungscode ein."}}));
                } else {
                    send(json!({}));
                }
            }
            "upload" | "download" => {
                let oid = msg["oid"].as_str().unwrap_or("").to_string();
                let size = msg["size"].as_u64().unwrap_or(0);
                let Some(s3) = client.as_ref() else {
                    complete_err(&oid, "Kein Zugangsschlüssel".into());
                    continue;
                };
                let key = s3.object_key(&oid);
                let so_far = Arc::new(AtomicU64::new(0));
                let last_report = Arc::new(AtomicU64::new(0));
                let oid_p = oid.clone();
                let (sf, lr) = (so_far.clone(), last_report.clone());
                let progress: crate::s3::ProgressFn = Arc::new(move |n: u64| {
                    let now = sf.fetch_add(n, Ordering::Relaxed) + n;
                    let last = lr.load(Ordering::Relaxed);
                    if now - last >= 512 * 1024 || now >= size {
                        lr.store(now, Ordering::Relaxed);
                        send(json!({"event": "progress", "oid": oid_p, "bytesSoFar": now, "bytesSinceLast": now - last}));
                    }
                });

                if event == "upload" {
                    let path = msg["path"].as_str().unwrap_or("");
                    // Schon vorhanden (z. B. vom Teamkollegen)? Dann überspringen.
                    if matches!(s3.exists(&key), Ok(true)) {
                        progress(size);
                        send(json!({"event": "complete", "oid": oid}));
                        continue;
                    }
                    match s3.put_file(&key, std::path::Path::new(path), size, progress) {
                        Ok(()) => send(json!({"event": "complete", "oid": oid})),
                        Err(e) => complete_err(&oid, e),
                    }
                } else {
                    let dest = tmp_dir.join(format!("unrealsync-{oid}-{}", std::process::id()));
                    match s3.get_to_file(&key, &oid, &dest, progress) {
                        Ok(()) => send(json!({"event": "complete", "oid": oid, "path": dest.to_string_lossy()})),
                        Err(e) => complete_err(&oid, e),
                    }
                }
            }
            "terminate" => break,
            _ => {}
        }
    }
    0
}
