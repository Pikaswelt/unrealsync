//! Minimaler S3-Client (AWS SigV4) für Cloudflare R2, Backblaze B2, MinIO & Co.

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::sync::Arc;

type HmacSha256 = Hmac<Sha256>;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct S3Location {
    pub endpoint: String,
    pub bucket: String,
    #[serde(default = "default_region")]
    pub region: String,
    #[serde(default)]
    pub prefix: String,
}

fn default_region() -> String {
    "auto".into()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct S3Keys {
    pub access_key: String,
    pub secret_key: String,
}

impl S3Location {
    /// Schlüssel für den Windows-Anmeldeinformationsspeicher
    pub fn secret_key_name(&self) -> String {
        let host = self
            .endpoint
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');
        format!("s3:{host}/{}", self.bucket)
    }
}

pub struct S3 {
    loc: S3Location,
    keys: S3Keys,
    client: reqwest::blocking::Client,
}

pub type ProgressFn = Arc<dyn Fn(u64) + Send + Sync>;

impl S3 {
    pub fn new(loc: S3Location, keys: S3Keys) -> Self {
        let client = reqwest::blocking::Client::builder()
            .user_agent("UnrealSync")
            .timeout(None)
            .connect_timeout(std::time::Duration::from_secs(20))
            .build()
            .expect("HTTP-Client");
        Self { loc, keys, client }
    }

    pub fn object_key(&self, oid: &str) -> String {
        let mut prefix = self.loc.prefix.trim_matches('/').to_string();
        if !prefix.is_empty() {
            prefix.push('/');
        }
        if oid.len() >= 4 {
            format!("{prefix}{}/{}/{oid}", &oid[0..2], &oid[2..4])
        } else {
            format!("{prefix}{oid}")
        }
    }

    fn url_and_headers(&self, method: &str, key: &str) -> Result<(String, Vec<(String, String)>), String> {
        let endpoint = self.loc.endpoint.trim_end_matches('/');
        let base = reqwest::Url::parse(endpoint).map_err(|e| format!("Ungültiger Endpoint: {e}"))?;
        let host = match base.port() {
            Some(p) => format!("{}:{p}", base.host_str().unwrap_or_default()),
            None => base.host_str().unwrap_or_default().to_string(),
        };
        let mut uri = format!("/{}", uri_encode(&self.loc.bucket));
        for seg in key.split('/') {
            uri.push('/');
            uri.push_str(&uri_encode(seg));
        }
        let url = format!("{}://{host}{uri}", base.scheme());

        let now = chrono::Utc::now();
        let amz_date = now.format("%Y%m%dT%H%M%SZ").to_string();
        let date = now.format("%Y%m%d").to_string();
        let payload = "UNSIGNED-PAYLOAD";
        let region = if self.loc.region.trim().is_empty() { "auto" } else { self.loc.region.trim() };

        let canonical_headers = format!("host:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz_date}\n");
        let signed_headers = "host;x-amz-content-sha256;x-amz-date";
        let canonical_request = format!("{method}\n{uri}\n\n{canonical_headers}\n{signed_headers}\n{payload}");
        let scope = format!("{date}/{region}/s3/aws4_request");
        let string_to_sign = format!(
            "AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{}",
            hex::encode(Sha256::digest(canonical_request.as_bytes()))
        );
        let k_date = hmac(format!("AWS4{}", self.keys.secret_key).as_bytes(), date.as_bytes());
        let k_region = hmac(&k_date, region.as_bytes());
        let k_service = hmac(&k_region, b"s3");
        let k_signing = hmac(&k_service, b"aws4_request");
        let signature = hex::encode(hmac(&k_signing, string_to_sign.as_bytes()));
        let auth = format!(
            "AWS4-HMAC-SHA256 Credential={}/{scope}, SignedHeaders={signed_headers}, Signature={signature}",
            self.keys.access_key
        );
        Ok((
            url,
            vec![
                ("x-amz-content-sha256".into(), payload.into()),
                ("x-amz-date".into(), amz_date),
                ("authorization".into(), auth),
            ],
        ))
    }

    fn request(&self, method: &str, key: &str) -> Result<reqwest::blocking::RequestBuilder, String> {
        let (url, headers) = self.url_and_headers(method, key)?;
        let m = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| e.to_string())?;
        let mut req = self.client.request(m, url);
        for (k, v) in headers {
            req = req.header(k, v);
        }
        Ok(req)
    }

    pub fn exists(&self, key: &str) -> Result<bool, String> {
        let resp = self.request("HEAD", key)?.send().map_err(|e| e.to_string())?;
        match resp.status().as_u16() {
            200 => Ok(true),
            404 => Ok(false),
            s => Err(format!("S3 HEAD fehlgeschlagen (HTTP {s})")),
        }
    }

    pub fn put_bytes(&self, key: &str, data: Vec<u8>) -> Result<(), String> {
        let resp = self.request("PUT", key)?.body(data).send().map_err(|e| e.to_string())?;
        check(resp)
    }

    pub fn delete(&self, key: &str) -> Result<(), String> {
        let resp = self.request("DELETE", key)?.send().map_err(|e| e.to_string())?;
        check(resp)
    }

    pub fn put_file(&self, key: &str, path: &Path, size: u64, progress: ProgressFn) -> Result<(), String> {
        let file = std::fs::File::open(path).map_err(|e| format!("Datei öffnen: {e}"))?;
        let reader = CountingReader { inner: file, progress };
        let body = reqwest::blocking::Body::sized(reader, size);
        let resp = self
            .request("PUT", key)?
            .header("content-length", size.to_string())
            .body(body)
            .send()
            .map_err(|e| e.to_string())?;
        check(resp)
    }

    /// Lädt ein Objekt in `dest` und prüft den SHA-256 (= LFS-OID).
    pub fn get_to_file(&self, key: &str, oid: &str, dest: &Path, progress: ProgressFn) -> Result<(), String> {
        let mut resp = self.request("GET", key)?.send().map_err(|e| e.to_string())?;
        if resp.status().as_u16() == 404 {
            return Err("Datei fehlt im Cloud-Speicher (wurde sie hochgeladen?)".into());
        }
        if !resp.status().is_success() {
            return check(resp);
        }
        let mut file = std::fs::File::create(dest).map_err(|e| format!("Temp-Datei: {e}"))?;
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 256 * 1024];
        loop {
            let n = resp.read(&mut buf).map_err(|e| format!("Download abgebrochen: {e}"))?;
            if n == 0 {
                break;
            }
            hasher.update(&buf[..n]);
            std::io::Write::write_all(&mut file, &buf[..n]).map_err(|e| e.to_string())?;
            progress(n as u64);
        }
        let got = hex::encode(hasher.finalize());
        if !oid.is_empty() && got != oid {
            let _ = std::fs::remove_file(dest);
            return Err(format!("Prüfsumme stimmt nicht ({got} ≠ {oid})"));
        }
        Ok(())
    }

    /// Verbindungstest: kleines Objekt schreiben, prüfen, löschen.
    pub fn self_test(&self) -> Result<(), String> {
        let key = self.object_key("unrealsync-verbindungstest");
        self.put_bytes(&key, b"ok".to_vec())?;
        if !self.exists(&key)? {
            return Err("Testdatei wurde nicht gefunden".into());
        }
        let _ = self.delete(&key);
        Ok(())
    }
}

struct CountingReader<R: Read> {
    inner: R,
    progress: ProgressFn,
}

impl<R: Read> Read for CountingReader<R> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        (self.progress)(n as u64);
        Ok(n)
    }
}

fn check(resp: reqwest::blocking::Response) -> Result<(), String> {
    let status = resp.status();
    if status.is_success() {
        return Ok(());
    }
    let body = resp.text().unwrap_or_default();
    let code = body
        .split("<Code>")
        .nth(1)
        .and_then(|s| s.split("</Code>").next())
        .unwrap_or("");
    Err(match status.as_u16() {
        401 | 403 => format!("Zugriff verweigert – Schlüssel prüfen ({code})"),
        404 => format!("Bucket nicht gefunden ({code})"),
        s => format!("S3-Fehler HTTP {s} {code}"),
    })
}

fn hmac(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC key");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn uri_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}
