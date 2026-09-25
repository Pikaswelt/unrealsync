import { useEffect, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowRight, Copy, ExternalLink, KeyRound, Loader2, Server } from "lucide-react";
import { Account, api, DeviceCode, errText } from "../lib/api";
import { Banner, Field, Github, useUi } from "../components/ui";

type Mode = "github" | "server";

export function LoginStep({ onLoggedIn, clientId }: { onLoggedIn: (a: Account) => void; clientId: string | null }) {
  const { toast } = useUi();
  const [mode, setMode] = useState<Mode>("github");
  const [device, setDevice] = useState<DeviceCode | null>(null);
  const [useToken, setUseToken] = useState(!clientId);
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(false);
  const [server, setServer] = useState({ baseUrl: "", login: "", token: "", email: "" });
  const [cid, setCid] = useState("");
  const polling = useRef(false);

  useEffect(() => () => void (polling.current = false), []);

  const startDevice = async () => {
    setLoading(true);
    try {
      const d = await api.deviceStart();
      setDevice(d);
      await navigator.clipboard.writeText(d.userCode).catch(() => {});
      openUrl(d.verificationUri);
      polling.current = true;
      let interval = d.interval;
      const deadline = Date.now() + d.expiresIn * 1000;
      while (polling.current && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, interval * 1000));
        if (!polling.current) return;
        try {
          const acc = await api.devicePoll(d.deviceCode);
          if (acc) {
            polling.current = false;
            onLoggedIn(acc);
            return;
          }
        } catch (e) {
          polling.current = false;
          setDevice(null);
          toast(errText(e), "error");
          return;
        }
        interval = Math.max(interval, d.interval);
      }
    } catch (e) {
      const msg = errText(e);
      if (msg.includes("NO_CLIENT_ID")) setUseToken(true);
      else toast(msg, "error");
    } finally {
      setLoading(false);
    }
  };

  const tokenLogin = async () => {
    setLoading(true);
    try {
      onLoggedIn(await api.tokenLogin(token));
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const serverLogin = async () => {
    setLoading(true);
    try {
      onLoggedIn(await api.serverLogin(server.baseUrl, server.login, server.token, server.email));
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="col" style={{ gap: 6 }}>
        <h1>Willkommen bei UnrealSync</h1>
        <p className="muted">
          Euer Unreal-Projekt gemeinsam speichern, Änderungen holen und hochladen – ohne Git-Kommandos. Melde dich zuerst an.
        </p>
      </div>

      <div className="choice-grid">
        <button className={`choice ${mode === "github" ? "on" : ""}`} onClick={() => setMode("github")}>
          <div className="ic">
            <Github size={20} />
          </div>
          <h3>GitHub</h3>
          <p>Empfohlen. Die App legt ein privates Repository für euch an.</p>
        </button>
        <button className={`choice ${mode === "server" ? "on" : ""}`} onClick={() => setMode("server")}>
          <div className="ic">
            <Server size={20} />
          </div>
          <h3>Eigener Git-Server</h3>
          <p>Forgejo, Gitea oder GitLab auf NAS / Server – ohne Speicherlimits.</p>
        </button>
      </div>

      {mode === "github" && !useToken && (
        <div className="card col" style={{ gap: 14 }}>
          {!device ? (
            <>
              <p className="muted">Du bestätigst die Anmeldung im Browser – dein Passwort sieht die App nie.</p>
              <div className="row">
                <button className="btn primary big" onClick={startDevice} disabled={loading}>
                  {loading ? <Loader2 className="spin" size={18} /> : <Github size={18} />} Mit GitHub anmelden
                </button>
                <button className="btn ghost" onClick={() => setUseToken(true)}>
                  <KeyRound size={16} /> Stattdessen Token verwenden
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="muted">
                Gib diesen Code auf <b>github.com/login/device</b> ein (er ist schon in deiner Zwischenablage):
              </p>
              <div className="device-code">{device.userCode}</div>
              <div className="row">
                <button className="btn" onClick={() => navigator.clipboard.writeText(device.userCode)}>
                  <Copy size={15} /> Kopieren
                </button>
                <button className="btn" onClick={() => openUrl(device.verificationUri)}>
                  <ExternalLink size={15} /> Seite erneut öffnen
                </button>
                <span className="row small muted" style={{ marginLeft: "auto" }}>
                  <Loader2 className="spin" size={15} /> Warte auf Bestätigung …
                </span>
              </div>
            </>
          )}
        </div>
      )}

      {mode === "github" && useToken && (
        <div className="card col" style={{ gap: 14 }}>
          {!clientId && (
            <Banner kind="info">
              Für den bequemen Browser-Login braucht die App eine GitHub-OAuth-App (Client-ID, siehe README). Bis dahin
              funktioniert die Anmeldung mit einem persönlichen Token genauso gut.
            </Banner>
          )}
          <ol className="muted" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
            <li>
              <a
                onClick={() =>
                  openUrl("https://github.com/settings/tokens/new?scopes=repo,read:user&description=UnrealSync")
                }
              >
                Token-Seite auf GitHub öffnen <ExternalLink size={11} />
              </a>{" "}
              (Häkchen „repo“ ist schon gesetzt)
            </li>
            <li>Ablaufdatum wählen → „Generate token“</li>
            <li>Token kopieren und hier einfügen</li>
          </ol>
          <Field label="Persönliches Zugriffstoken">
            <input className="input mono" type="password" value={token} placeholder="ghp_…" onChange={(e) => setToken(e.target.value)} />
          </Field>
          <div className="row">
            <button className="btn primary" disabled={!token.trim() || loading} onClick={tokenLogin}>
              {loading ? <Loader2 className="spin" size={16} /> : <ArrowRight size={16} />} Anmelden
            </button>
            {clientId && (
              <button className="btn ghost" onClick={() => setUseToken(false)}>
                Zurück zum Browser-Login
              </button>
            )}
          </div>
          {!clientId && (
            <details>
              <summary className="small faint" style={{ cursor: "pointer" }}>
                Erweitert: GitHub-OAuth-Client-ID eintragen
              </summary>
              <div className="row" style={{ marginTop: 10 }}>
                <input className="input mono" placeholder="Ov23li…" value={cid} onChange={(e) => setCid(e.target.value)} />
                <button
                  className="btn"
                  disabled={!cid.trim()}
                  onClick={async () => {
                    await api.updateSettings({ githubClientId: cid });
                    toast("Client-ID gespeichert – Browser-Login ist jetzt verfügbar.", "ok");
                    location.reload();
                  }}
                >
                  Speichern
                </button>
              </div>
            </details>
          )}
        </div>
      )}

      {mode === "server" && (
        <div className="card col" style={{ gap: 14 }}>
          <Field label="Server-Adresse" hint="z. B. https://git.meinserver.de">
            <input className="input mono" value={server.baseUrl} onChange={(e) => setServer({ ...server, baseUrl: e.target.value })} />
          </Field>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <div className="grow">
              <Field label="Benutzername">
                <input className="input" value={server.login} onChange={(e) => setServer({ ...server, login: e.target.value })} />
              </Field>
            </div>
            <div className="grow">
              <Field label="E-Mail (für den Verlauf)">
                <input className="input" value={server.email} onChange={(e) => setServer({ ...server, email: e.target.value })} />
              </Field>
            </div>
          </div>
          <Field label="Zugriffstoken" hint="In Forgejo/Gitea: Einstellungen → Anwendungen → Token mit Repository-Schreibrechten.">
            <input className="input mono" type="password" value={server.token} onChange={(e) => setServer({ ...server, token: e.target.value })} />
          </Field>
          <div>
            <button
              className="btn primary"
              disabled={!server.baseUrl.trim() || !server.login.trim() || !server.token.trim() || loading}
              onClick={serverLogin}
            >
              <ArrowRight size={16} /> Weiter
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
