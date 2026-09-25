import { useEffect, useMemo, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  FolderOpen,
  Gamepad2,
  Lock,
  Mail,
  RefreshCw,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { Account, api, AppSnapshot, errText, FolderCheck, Invitation, RemoteRepo, StorageInput } from "../lib/api";
import { ago, bytes, isOneDrive } from "../lib/format";
import { Banner, Field, Toggle, useUi } from "../components/ui";
import { emptyS3, S3Form, s3Complete, S3Value, StorageChoice } from "../components/StorageForm";
import { LoginStep } from "./Login";

type Step = "login" | "mode" | "new" | "join" | "access" | "done";

export function Setup({
  snap,
  onDone,
  onCancel,
}: {
  snap: AppSnapshot;
  onDone: () => void;
  onCancel?: () => void;
}) {
  const [account, setAccount] = useState<Account | null>(snap.account);
  const [step, setStep] = useState<Step>(snap.account ? "mode" : "login");
  const [doneText, setDoneText] = useState("");
  const stepIndex = { login: 0, mode: 1, new: 2, join: 2, access: 3, done: 3 }[step];

  return (
    <div className="setup">
      <div className="setup-inner">
        <div className="row between">
          <div className="brand">
            <div className="brand-logo">
              <RefreshCw size={20} />
            </div>
            <div className="brand-name">UnrealSync</div>
          </div>
          {onCancel && (
            <button className="btn ghost" onClick={onCancel}>
              <ArrowLeft size={16} /> Zurück zur App
            </button>
          )}
        </div>
        <div className="steps">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={i <= stepIndex ? "on" : ""} />
          ))}
        </div>

        {step === "login" && (
          <LoginStep
            clientId={snap.githubClientId}
            onLoggedIn={(a) => {
              setAccount(a);
              setStep("mode");
            }}
          />
        )}
        {step === "mode" && account && <ModeStep account={account} onPick={setStep} onRelogin={() => setStep("login")} />}
        {step === "new" && account && (
          <NewProject
            account={account}
            onBack={() => setStep("mode")}
            onDone={(t) => {
              setDoneText(t);
              setStep("done");
            }}
          />
        )}
        {step === "join" && account && (
          <JoinProject
            account={account}
            onBack={() => setStep("mode")}
            onDone={(needsCode) => {
              if (needsCode) setStep("access");
              else {
                setDoneText("Das Projekt ist heruntergeladen. Du kannst es jetzt in Unreal öffnen.");
                setStep("done");
              }
            }}
          />
        )}
        {step === "access" && (
          <AccessCodeStep
            onDone={() => {
              setDoneText("Alles da! Das Projekt ist vollständig heruntergeladen.");
              setStep("done");
            }}
          />
        )}
        {step === "done" && (
          <div className="card col" style={{ gap: 16, alignItems: "center", textAlign: "center", padding: 36 }}>
            <CheckCircle2 size={52} color="var(--teal)" />
            <h1>Fertig eingerichtet!</h1>
            <p className="muted" style={{ maxWidth: 460 }}>
              {doneText}
            </p>
            <button className="btn primary big" onClick={onDone}>
              Zum Projekt
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ModeStep({ account, onPick, onRelogin }: { account: Account; onPick: (s: Step) => void; onRelogin: () => void }) {
  const [invites, setInvites] = useState<Invitation[]>([]);
  useEffect(() => {
    if (account.kind === "github") api.invitations().then(setInvites).catch(() => {});
  }, [account]);

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="col" style={{ gap: 6 }}>
        <h1>Hallo {account.name}!</h1>
        <p className="muted">
          Angemeldet als <b>{account.login}</b> ({account.kind === "github" ? "GitHub" : account.baseUrl}).{" "}
          <a onClick={onRelogin}>Anderes Konto</a>
        </p>
      </div>
      {invites.length > 0 && (
        <Banner kind="ok" icon={<Mail size={17} />}>
          Du hast {invites.length === 1 ? "eine Einladung" : `${invites.length} Einladungen`}:{" "}
          {invites.map((i) => (
            <b key={i.id}>
              {i.repo.fullName} (von {i.inviter}){" "}
            </b>
          ))}
          – wähle „Projekt beitreten“.
        </Banner>
      )}
      <div className="choice-grid">
        <button className="choice" onClick={() => onPick("new")}>
          <div className="ic">
            <Upload size={20} />
          </div>
          <h3>Neues Projekt hochladen</h3>
          <p>Du hast das Unreal-Projekt auf deinem PC und willst es zum ersten Mal mit deinem Team teilen.</p>
        </button>
        <button className="choice" onClick={() => onPick("join")}>
          <div className="ic">
            <Users size={20} />
          </div>
          <h3>Projekt beitreten</h3>
          <p>Jemand hat das Projekt schon hochgeladen und dich eingeladen. Du lädst es herunter.</p>
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Neues Projekt

function NewProject({ account, onBack, onDone }: { account: Account; onBack: () => void; onDone: (text: string) => void }) {
  const { runOp, toast } = useUi();
  const [path, setPath] = useState("");
  const [check, setCheck] = useState<FolderCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [name, setName] = useState("");
  const [priv, setPriv] = useState(true);
  const [storage, setStorage] = useState<"lfs" | "s3">("lfs");
  const [s3, setS3] = useState<S3Value>(emptyS3());
  const [invite, setInvite] = useState("");
  const [serverUrl, setServerUrl] = useState("");
  const isServer = account.kind === "server";

  const pick = async () => {
    const dir = await open({ directory: true, title: "Unreal-Projektordner wählen" });
    if (typeof dir !== "string") return;
    setPath(dir);
    setChecking(true);
    try {
      const c = await api.checkFolder(dir);
      setCheck(c);
      const base = (c.uproject ?? dir.split(/[\\/]/).pop() ?? "").replace(/\.uproject$/i, "");
      setName(base.replace(/[^A-Za-z0-9._-]+/g, "-"));
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setChecking(false);
    }
  };

  const valid =
    !!check?.exists &&
    !!name.trim() &&
    /^[A-Za-z0-9._-]+$/.test(name) &&
    (storage === "lfs" || s3Complete(s3)) &&
    (!isServer || !!serverUrl.trim());

  const submit = async () => {
    const st: StorageInput = storage === "lfs" ? { type: "lfs" } : { type: "s3", ...s3 };
    const res = await runOp("Projekt wird hochgeladen", () =>
      api.createProject({
        path,
        repoName: name.trim(),
        private: priv,
        storage: st,
        serverRepoUrl: isServer ? serverUrl : undefined,
        invite: invite.trim() || undefined,
      }),
    );
    if (!res) return;
    let text = "Dein Projekt ist online.";
    if (invite.trim()) text += ` ${invite.trim()} hat eine Einladung per E-Mail bekommen und kann mit UnrealSync „Projekt beitreten“.`;
    if (storage === "s3") text += " Den Zugangscode für den Cloud-Speicher findest du unter „Speicher“ – schick ihn deinem Team privat.";
    onDone(text);
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row">
        <button className="btn ghost icon" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h1>Neues Projekt hochladen</h1>
      </div>

      <div className="card col" style={{ gap: 14 }}>
        <h3>1. Projektordner</h3>
        <div className="row">
          <input className="input mono grow" readOnly value={path} placeholder="Ordner mit der .uproject-Datei" />
          <button className="btn" onClick={pick}>
            <FolderOpen size={16} /> Auswählen
          </button>
        </div>
        {checking && <div className="progress indeterminate"><div /></div>}
        {check && (
          <>
            {!check.uproject && <Banner kind="warn">In diesem Ordner liegt keine .uproject-Datei. Ist das wirklich dein Unreal-Projekt?</Banner>}
            {check.inOnedrive && (
              <Banner kind="danger">
                <b>Der Ordner liegt in OneDrive.</b> OneDrive synchronisiert parallel und kann Git- und Unreal-Dateien beschädigen
                oder sperren. Verschiebe das Projekt am besten nach z. B. <code>C:\UnrealProjekte</code>.
              </Banner>
            )}
            {check.isGitRepo && <Banner kind="info">Der Ordner ist schon ein Git-Repository – UnrealSync übernimmt es.</Banner>}
            <div className="stat-grid">
              <div className="stat">
                <div className="v">{check.uproject?.replace(/\.uproject$/i, "") ?? "–"}</div>
                <div className="l">Unreal-Projekt</div>
              </div>
              <div className="stat">
                <div className="v">{bytes(check.totalBytes)}</div>
                <div className="l">wird hochgeladen</div>
              </div>
              <div className="stat">
                <div className="v">{check.fileCount.toLocaleString("de-DE")}</div>
                <div className="l">Dateien</div>
              </div>
            </div>
            {check.bigFiles.length > 0 && (
              <Banner kind="warn">
                {check.bigFiles.length} Datei(en) über 100 MB, z. B. <code>{check.bigFiles[0][0]}</code> ({bytes(check.bigFiles[0][1])}).
                Die kosten viel Speicher – prüfe, ob sie wirklich ins Projekt gehören.
              </Banner>
            )}
            {check.sourceFiles.length > 0 && (
              <Banner kind="info">
                {check.sourceFiles.length} Quelldatei(en) (.blend, .psd …) gefunden. Die werden mit hochgeladen – bei vielen
                Versionen wächst der Speicher schnell.
              </Banner>
            )}
            {storage === "lfs" && !isServer && check.totalBytes > 8 * 1024 ** 3 && (
              <Banner kind="warn">
                Das Projekt ist größer als ~8 GB. GitHub LFS ist bis 10 GB gratis – ein eigener Cloud-Speicher (R2) ist hier
                wahrscheinlich günstiger.
              </Banner>
            )}
          </>
        )}
      </div>

      <div className="card col" style={{ gap: 14 }}>
        <h3>2. Name {isServer ? "& Repository" : "auf GitHub"}</h3>
        <Field label="Repository-Name" hint="Nur Buchstaben, Zahlen, - _ und .">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {isServer ? (
          <Field label="URL des (leeren) Repositorys" hint="Lege das Repo vorher in der Weboberfläche deines Servers an.">
            <input className="input mono" value={serverUrl} placeholder={`${account.baseUrl}/${account.login}/${name || "mein-spiel"}.git`} onChange={(e) => setServerUrl(e.target.value)} />
          </Field>
        ) : (
          <Toggle checked={priv} onChange={setPriv} label={<span className="row" style={{ gap: 6 }}><Lock size={14} /> Privat (nur eingeladene Personen)</span>} />
        )}
      </div>

      <div className="card col" style={{ gap: 14 }}>
        <h3>3. Wo sollen große Dateien liegen?</h3>
        <StorageChoice value={storage} onChange={setStorage} serverAccount={isServer} />
        {storage === "s3" && <S3Form value={s3} onChange={setS3} />}
        <p className="hint">Keine Sorge: Du kannst später unter „Speicher“ jederzeit umziehen.</p>
      </div>

      {!isServer && (
        <div className="card col" style={{ gap: 14 }}>
          <h3>4. Teammitglied einladen (optional)</h3>
          <Field label="GitHub-Benutzername deines Freundes">
            <div className="row">
              <UserPlus size={18} className="faint" />
              <input className="input" value={invite} placeholder="z. B. maxmustermann" onChange={(e) => setInvite(e.target.value)} />
            </div>
          </Field>
        </div>
      )}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary big" disabled={!valid} onClick={submit}>
          <Upload size={18} /> Projekt hochladen
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Beitreten

function JoinProject({ account, onBack, onDone }: { account: Account; onBack: () => void; onDone: (needsCode: boolean) => void }) {
  const { runOp, toast } = useUi();
  const [repos, setRepos] = useState<RemoteRepo[] | null>(null);
  const [invites, setInvites] = useState<Invitation[]>([]);
  const [selected, setSelected] = useState<RemoteRepo | null>(null);
  const [url, setUrl] = useState("");
  const [parent, setParent] = useState("");
  const [folder, setFolder] = useState("");
  const [filter, setFilter] = useState("");
  const isGithub = account.kind === "github";

  const load = async () => {
    if (!isGithub) return;
    try {
      const [r, i] = await Promise.all([api.listRepos(), api.invitations()]);
      setRepos(r);
      setInvites(i);
    } catch (e) {
      toast(errText(e), "error");
      setRepos([]);
    }
  };
  useEffect(() => {
    load();
  }, []);

  const accept = async (inv: Invitation) => {
    const ok = await runOp("Einladung annehmen", () => api.acceptInvitation(inv.id));
    if (ok !== null) {
      await load();
      setSelected(inv.repo);
      setFolder(inv.repo.name);
    }
  };

  const shown = useMemo(
    () => (repos ?? []).filter((r) => r.fullName.toLowerCase().includes(filter.toLowerCase())),
    [repos, filter],
  );

  const pickParent = async () => {
    const dir = await open({ directory: true, title: "Wohin soll das Projekt?" });
    if (typeof dir === "string") setParent(dir);
  };

  const cloneUrl = isGithub ? selected?.cloneUrl ?? "" : url.trim();
  const valid = !!cloneUrl && !!parent && !!folder.trim();

  const submit = async () => {
    const res = await runOp("Projekt wird heruntergeladen", () =>
      api.joinProject({ cloneUrl, parentDir: parent, folderName: folder.trim(), githubRepo: selected?.fullName ?? null }),
    );
    if (res) onDone(res.needsAccessCode);
  };

  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row">
        <button className="btn ghost icon" onClick={onBack}>
          <ArrowLeft size={18} />
        </button>
        <h1>Projekt beitreten</h1>
      </div>

      {invites.length > 0 && (
        <div className="card col" style={{ gap: 10 }}>
          <h3>Offene Einladungen</h3>
          {invites.map((i) => (
            <div key={i.id} className="row">
              <Mail size={17} color="var(--teal)" />
              <div className="grow">
                <b>{i.repo.fullName}</b> <span className="muted small">von {i.inviter}</span>
              </div>
              <button className="btn teal sm" onClick={() => accept(i)}>
                Annehmen
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card col" style={{ gap: 12 }}>
        <h3>1. Welches Projekt?</h3>
        {isGithub ? (
          <>
            <input className="input" placeholder="Suchen …" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="card tight" style={{ maxHeight: 280, overflow: "auto" }}>
              {repos === null && <div className="empty">Lade Repositories …</div>}
              {repos?.length === 0 && (
                <div className="empty">
                  Keine Repositories gefunden. Hast du die Einladung schon bekommen?
                  <button className="btn sm" onClick={load}>
                    <RefreshCw size={14} /> Neu laden
                  </button>
                </div>
              )}
              <div className="list">
                {shown.map((r) => (
                  <div
                    key={r.fullName}
                    className="list-item"
                    style={{ cursor: "pointer", background: selected?.fullName === r.fullName ? "var(--accent-soft)" : undefined }}
                    onClick={() => {
                      setSelected(r);
                      setFolder(r.name);
                    }}
                  >
                    <div className="file-ic asset">
                      <Gamepad2 size={17} />
                    </div>
                    <div className="grow">
                      <div className="ellipsis">
                        <b>{r.name}</b> <span className="faint small">{r.owner}</span>
                      </div>
                      <div className="small faint">zuletzt aktualisiert {ago(r.updatedAt)}</div>
                    </div>
                    {r.private && <span className="badge">privat</span>}
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <Field label="Repository-URL" hint="Kopiere die HTTPS-Adresse aus der Weboberfläche deines Servers.">
            <input
              className="input mono"
              value={url}
              placeholder={`${account.baseUrl}/team/mein-spiel.git`}
              onChange={(e) => {
                setUrl(e.target.value);
                const n = e.target.value.trim().split("/").pop()?.replace(/\.git$/, "");
                if (n) setFolder(n);
              }}
            />
          </Field>
        )}
      </div>

      <div className="card col" style={{ gap: 12 }}>
        <h3>2. Speicherort auf deinem PC</h3>
        <div className="row">
          <input className="input mono grow" readOnly value={parent} placeholder="z. B. C:\UnrealProjekte" />
          <button className="btn" onClick={pickParent}>
            <FolderOpen size={16} /> Auswählen
          </button>
        </div>
        {parent && isOneDrive(parent) && (
          <Banner kind="danger">
            Dieser Ort liegt in OneDrive – das führt bei Unreal-Projekten zu gesperrten und beschädigten Dateien. Wähle lieber einen
            Ordner außerhalb (z. B. <code>C:\UnrealProjekte</code>).
          </Banner>
        )}
        <Field label="Ordnername">
          <input className="input" value={folder} onChange={(e) => setFolder(e.target.value)} />
        </Field>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary big" disabled={!valid} onClick={submit}>
          <Download size={18} /> Herunterladen
        </button>
      </div>
    </div>
  );
}

export function AccessCodeStep({ onDone }: { onDone: () => void }) {
  const { runOp } = useUi();
  const [code, setCode] = useState("");
  const submit = async () => {
    const r = await runOp("Große Dateien werden geladen", () => api.submitAccessCode(code));
    if (r !== null) onDone();
  };
  return (
    <div className="card col" style={{ gap: 14 }}>
      <h2>Zugangscode für den Cloud-Speicher</h2>
      <p className="muted">
        Dieses Projekt speichert große Dateien in einem eigenen Cloud-Speicher. Frag die Person, die das Projekt hochgeladen hat,
        nach dem Zugangscode (steht bei ihr unter „Speicher“).
      </p>
      <textarea className="input mono" rows={3} placeholder="USYNC1.…" value={code} onChange={(e) => setCode(e.target.value)} />
      <div>
        <button className="btn primary" disabled={!code.trim().startsWith("USYNC1.")} onClick={submit}>
          Code prüfen &amp; Dateien laden
        </button>
      </div>
    </div>
  );
}
