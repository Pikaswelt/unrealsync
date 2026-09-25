import { useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, FolderOpen, LogOut, Trash2 } from "lucide-react";
import { api, AppSnapshot } from "../lib/api";
import { Avatar, Field, Toggle, useUi } from "../components/ui";

export function SettingsTab({ snap, reload }: { snap: AppSnapshot; reload: () => void }) {
  const { toast } = useUi();
  const [autoLock, setAutoLock] = useState(snap.autoLock);
  const [tray, setTray] = useState(snap.closeToTray);
  const [cid, setCid] = useState(snap.githubClientId ?? "");
  const acc = snap.account!;
  const project = snap.activeProject!;

  const save = async (patch: Parameters<typeof api.updateSettings>[0]) => {
    await api.updateSettings(patch);
    toast("Gespeichert.", "ok");
  };

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <h1>Einstellungen</h1>

      <div className="card col" style={{ gap: 16 }}>
        <h3>Verhalten</h3>
        <div className="row between">
          <div>
            <div style={{ fontWeight: 600 }}>Automatisch sperren</div>
            <div className="small faint">Speicherst du ein Asset in Unreal, sperrt UnrealSync es sofort für dich.</div>
          </div>
          <Toggle
            checked={autoLock}
            onChange={(v) => {
              setAutoLock(v);
              save({ autoLock: v });
            }}
          />
        </div>
        <div className="divider" />
        <div className="row between">
          <div>
            <div style={{ fontWeight: 600 }}>Im Hintergrund weiterlaufen</div>
            <div className="small faint">Beim Schließen ins Tray minimieren – so bekommst du Hinweise auf neue Änderungen.</div>
          </div>
          <Toggle
            checked={tray}
            onChange={(v) => {
              setTray(v);
              save({ closeToTray: v });
            }}
          />
        </div>
      </div>

      <div className="card col" style={{ gap: 14 }}>
        <h3>Projekt</h3>
        <div className="row">
          <div className="grow" style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{project.name}</div>
            <div className="small faint mono ellipsis">{project.path}</div>
            <div className="small faint mono ellipsis">{project.remoteUrl}</div>
          </div>
          <button className="btn" onClick={() => api.openPath(project.path)}>
            <FolderOpen size={15} /> Öffnen
          </button>
          {project.githubRepo && (
            <button className="btn" onClick={() => openUrl(`https://github.com/${project.githubRepo}`)}>
              <ExternalLink size={15} /> GitHub
            </button>
          )}
          <button
            className="btn danger"
            title="Entfernt das Projekt nur aus der App – Dateien bleiben erhalten"
            onClick={async () => {
              await api.removeProject(project.path);
              toast("Projekt aus der Liste entfernt (Dateien bleiben erhalten).", "info");
              reload();
            }}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      <div className="card col" style={{ gap: 14 }}>
        <h3>Konto</h3>
        <div className="row">
          <Avatar name={acc.name} url={acc.avatarUrl} lg />
          <div className="grow">
            <div style={{ fontWeight: 600 }}>{acc.name}</div>
            <div className="small faint">
              @{acc.login} · {acc.kind === "github" ? "GitHub" : acc.baseUrl}
            </div>
          </div>
          <button
            className="btn"
            onClick={async () => {
              await api.logout();
              reload();
            }}
          >
            <LogOut size={15} /> Abmelden
          </button>
        </div>
      </div>

      <div className="card col" style={{ gap: 14 }}>
        <h3>Technik</h3>
        <div className="small muted">
          Git: <span className="mono">{snap.gitVersion}</span> {snap.bundledGit ? "(mitgeliefert)" : "(vom System)"}
        </div>
        <Field label="GitHub-OAuth-Client-ID" hint="Für den Browser-Login (Device Flow). Leer lassen, wenn du dich per Token anmeldest.">
          <div className="row">
            <input className="input mono" value={cid} placeholder="Ov23li…" onChange={(e) => setCid(e.target.value)} />
            <button className="btn" onClick={() => save({ githubClientId: cid })}>
              Speichern
            </button>
          </div>
        </Field>
      </div>
    </div>
  );
}
