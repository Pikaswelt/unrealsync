import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Cloud, ExternalLink, PlugZap, Server } from "lucide-react";
import { api, errText, S3Keys, S3Location } from "../lib/api";
import { Banner, Field, Github } from "./ui";

export type S3Value = { location: S3Location; keys: S3Keys };

export const emptyS3 = (): S3Value => ({
  location: { endpoint: "", bucket: "", region: "auto", prefix: "" },
  keys: { accessKey: "", secretKey: "" },
});

export function s3Complete(v: S3Value) {
  return !!(v.location.endpoint.trim() && v.location.bucket.trim() && v.keys.accessKey.trim() && v.keys.secretKey.trim());
}

type Provider = "r2" | "b2" | "other";

export function S3Form({ value, onChange }: { value: S3Value; onChange: (v: S3Value) => void }) {
  const [provider, setProvider] = useState<Provider>("r2");
  const [accountId, setAccountId] = useState("");
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const setLoc = (p: Partial<S3Location>) => onChange({ ...value, location: { ...value.location, ...p } });
  const setKeys = (p: Partial<S3Keys>) => onChange({ ...value, keys: { ...value.keys, ...p } });

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      await api.testS3(value.location, value.keys);
      setResult({ ok: true, text: "Verbindung klappt – Lesen und Schreiben funktioniert." });
    } catch (e) {
      setResult({ ok: false, text: errText(e) });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row wrap">
        {(
          [
            ["r2", "Cloudflare R2"],
            ["b2", "Backblaze B2"],
            ["other", "Anderer S3-Speicher"],
          ] as [Provider, string][]
        ).map(([id, label]) => (
          <button
            key={id}
            className={`btn sm ${provider === id ? "primary" : ""}`}
            onClick={() => {
              setProvider(id);
              setLoc({ region: id === "r2" ? "auto" : value.location.region === "auto" ? "" : value.location.region });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {provider === "r2" && (
        <Banner kind="info">
          R2: 10 GB gratis, <b>Downloads kostenlos</b>. In Cloudflare → R2 einen Bucket anlegen, dann „API-Token verwalten“ →
          Token mit „Objekt lesen &amp; schreiben“ erstellen.{" "}
          <a onClick={() => openUrl("https://dash.cloudflare.com/?to=/:account/r2/overview")}>
            Cloudflare öffnen <ExternalLink size={11} />
          </a>
        </Banner>
      )}
      {provider === "b2" && (
        <Banner kind="info">
          Backblaze B2: Bucket anlegen (privat), dann unter „Application Keys“ einen Schlüssel für den Bucket erstellen. Der
          Endpoint steht beim Bucket (z. B. <code>s3.eu-central-003.backblazeb2.com</code>).
        </Banner>
      )}

      {provider === "r2" ? (
        <Field label="Cloudflare Account-ID" hint="Steht rechts in der R2-Übersicht.">
          <input
            className="input mono"
            value={accountId}
            placeholder="z. B. 4f9a1c…"
            onChange={(e) => {
              const id = e.target.value.trim();
              setAccountId(id);
              setLoc({ endpoint: id ? `https://${id}.r2.cloudflarestorage.com` : "", region: "auto" });
            }}
          />
        </Field>
      ) : (
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div className="grow">
            <Field label="Endpoint">
              <input
                className="input mono"
                value={value.location.endpoint}
                placeholder="https://s3.eu-central-003.backblazeb2.com"
                onChange={(e) => setLoc({ endpoint: e.target.value.trim() })}
              />
            </Field>
          </div>
          <div style={{ width: 170 }}>
            <Field label="Region">
              <input
                className="input mono"
                value={value.location.region}
                placeholder="eu-central-003"
                onChange={(e) => setLoc({ region: e.target.value.trim() })}
              />
            </Field>
          </div>
        </div>
      )}

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <Field label="Bucket-Name">
            <input className="input mono" value={value.location.bucket} onChange={(e) => setLoc({ bucket: e.target.value.trim() })} />
          </Field>
        </div>
        <div className="grow">
          <Field label="Unterordner (optional)" hint="Praktisch, wenn mehrere Projekte einen Bucket teilen.">
            <input className="input mono" value={value.location.prefix} placeholder="mein-spiel" onChange={(e) => setLoc({ prefix: e.target.value.trim() })} />
          </Field>
        </div>
      </div>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <Field label="Access Key ID">
            <input className="input mono" value={value.keys.accessKey} onChange={(e) => setKeys({ accessKey: e.target.value.trim() })} />
          </Field>
        </div>
        <div className="grow">
          <Field label="Secret Access Key">
            <input
              className="input mono"
              type="password"
              value={value.keys.secretKey}
              onChange={(e) => setKeys({ secretKey: e.target.value.trim() })}
            />
          </Field>
        </div>
      </div>
      <div className="row">
        <button className="btn" disabled={!s3Complete(value) || testing} onClick={test}>
          <PlugZap size={16} /> {testing ? "Teste …" : "Verbindung testen"}
        </button>
        <span className="hint">Schlüssel werden im Windows-Anmeldeinformationsspeicher abgelegt, nie im Repo.</span>
      </div>
      {result && <Banner kind={result.ok ? "ok" : "danger"}>{result.text}</Banner>}
    </div>
  );
}

export function StorageChoice({
  value,
  onChange,
  serverAccount,
}: {
  value: "lfs" | "s3";
  onChange: (v: "lfs" | "s3") => void;
  serverAccount: boolean;
}) {
  return (
    <div className="choice-grid">
      <button className={`choice ${value === "lfs" ? "on" : ""}`} onClick={() => onChange("lfs")}>
        <div className="ic">{serverAccount ? <Server size={20} /> : <Github size={20} />}</div>
        <h3>{serverAccount ? "Speicher des Git-Servers" : "GitHub LFS"}</h3>
        <p>
          {serverAccount
            ? "Große Dateien liegen auf eurem eigenen Server – keine Limits außer eurer Festplatte."
            : "Null Einrichtung. 10 GB Speicher + 10 GB Download/Monat gratis, danach Abrechnung pro GB."}
        </p>
      </button>
      <button className={`choice ${value === "s3" ? "on" : ""}`} onClick={() => onChange("s3")}>
        <div className="ic">
          <Cloud size={20} />
        </div>
        <h3>Eigener Cloud-Speicher</h3>
        <p>Cloudflare R2, Backblaze B2 oder S3. Code bleibt bei GitHub, große Dateien gehen in euren Bucket – R2 ohne Download-Kosten.</p>
      </button>
    </div>
  );
}
