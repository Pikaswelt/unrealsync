import { useEffect, useMemo, useState } from "react";
import { Lock, LockOpen, ShieldAlert, UserPlus, Users } from "lucide-react";
import { api, AppSnapshot, Collaborator, CommitInfo, errText, LockInfo } from "../lib/api";
import { ago, displayName } from "../lib/format";
import { Avatar, Modal, useUi } from "../components/ui";
import type { ProjectData } from "./Dashboard";

export function TeamTab({ snap, data }: { snap: AppSnapshot; data: ProjectData }) {
  const { runOp, toast } = useUi();
  const [members, setMembers] = useState<Collaborator[] | null>(null);
  const [history, setHistory] = useState<CommitInfo[]>([]);
  const [invite, setInvite] = useState("");
  const [forceAsk, setForceAsk] = useState<LockInfo | null>(null);
  const me = snap.account!;
  const isGithub = !!snap.activeProject?.githubRepo && me.kind === "github";

  const loadMembers = () => {
    if (isGithub) api.teamMembers().then(setMembers).catch((e) => toast(errText(e), "error"));
  };

  useEffect(() => {
    loadMembers();
    api.history(150).then(setHistory).catch(() => {});
    data.refreshLocks();
  }, []);

  // Personen = Mitglieder + alle, die Sperren halten oder im Verlauf vorkommen
  const people = useMemo(() => {
    const map = new Map<string, { name: string; avatar?: string | null; pending?: boolean; locks: LockInfo[]; last?: CommitInfo }>();
    const key = (n: string) => n.toLowerCase();
    for (const m of members ?? []) map.set(key(m.login), { name: m.login, avatar: m.avatarUrl, pending: m.pending, locks: [] });
    for (const l of data.locks) {
      const k = key(l.owner);
      if (!map.has(k)) map.set(k, { name: l.owner, locks: [] });
      map.get(k)!.locks.push(l);
    }
    for (const c of history) {
      const k = key(c.author);
      const hit = map.get(k) ?? [...map.values()].find((p) => key(p.name) === k);
      if (hit && !hit.last) hit.last = c;
      else if (!hit && !members) map.set(k, { name: c.author, locks: [], last: c });
    }
    return [...map.values()].sort((a, b) => b.locks.length - a.locks.length || a.name.localeCompare(b.name));
  }, [members, data.locks, history]);

  const sendInvite = async () => {
    const r = await runOp("Einladung senden", () => api.teamInvite(invite));
    if (r !== null) {
      toast(`${invite} wurde eingeladen. Die Person bekommt eine E-Mail von GitHub und kann dann in UnrealSync „Projekt beitreten“.`, "ok");
      setInvite("");
      loadMembers();
    }
  };

  const unlock = async (l: LockInfo, force: boolean) => {
    await runOp(force ? "Sperre aufheben" : "Freigeben", () => api.unlock([l.path], force));
    await data.refreshLocks();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>Team &amp; Sperren</h1>
          <p className="muted">Wer arbeitet gerade woran? Gesperrte Assets kann nur die jeweilige Person hochladen.</p>
        </div>
      </div>

      <div className="two-col">
        <div className="col" style={{ gap: 14 }}>
          {people.length === 0 && (
            <div className="card empty">
              <Users size={30} /> Noch niemand da.
            </div>
          )}
          {people.map((p) => {
            const isMe = p.name.toLowerCase() === me.login.toLowerCase() || p.name === me.name;
            return (
              <div key={p.name} className="card tight">
                <div className="card-head">
                  <Avatar name={p.name} url={p.avatar ?? (isMe ? me.avatarUrl : null)} lg />
                  <div className="grow">
                    <div className="row" style={{ gap: 8 }}>
                      <b>{p.name}</b>
                      {isMe && <span className="badge accent">du</span>}
                      {p.pending && <span className="badge warn">eingeladen</span>}
                    </div>
                    <div className="small faint ellipsis">
                      {p.last ? `Zuletzt hochgeladen ${ago(p.last.date)}: ${p.last.message}` : "Noch nichts hochgeladen"}
                    </div>
                  </div>
                  {p.locks.length > 0 ? (
                    <span className={`badge ${isMe ? "teal" : "warn"}`}>
                      <Lock size={11} /> arbeitet an {p.locks.length}
                    </span>
                  ) : (
                    <span className="badge">frei</span>
                  )}
                </div>
                {p.locks.length > 0 && (
                  <div className="list">
                    {p.locks.map((l) => {
                      const { name, dir } = displayName(l.path);
                      return (
                        <div key={l.id} className="list-item">
                          <Lock size={15} color={l.ours ? "var(--teal)" : "var(--warn)"} />
                          <div className="grow" style={{ minWidth: 0 }}>
                            <div className="ellipsis" style={{ fontWeight: 600 }}>
                              {name}
                            </div>
                            <div className="small faint mono ellipsis">{dir}</div>
                          </div>
                          <span className="small faint">{ago(l.lockedAt)}</span>
                          {l.ours ? (
                            <button className="btn sm" onClick={() => unlock(l, false)}>
                              <LockOpen size={13} /> Freigeben
                            </button>
                          ) : (
                            <button className="btn ghost sm" title="Nur im Notfall – z. B. wenn jemand vergessen hat freizugeben" onClick={() => setForceAsk(l)}>
                              <ShieldAlert size={13} /> Aufheben
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="col" style={{ gap: 14 }}>
          {isGithub ? (
            <div className="card col" style={{ gap: 12 }}>
              <h3>Jemanden einladen</h3>
              <p className="small faint">Die Person braucht ein (kostenloses) GitHub-Konto und installiert UnrealSync.</p>
              <div className="row">
                <input className="input" placeholder="GitHub-Benutzername" value={invite} onChange={(e) => setInvite(e.target.value)} onKeyDown={(e) => e.key === "Enter" && invite.trim() && sendInvite()} />
                <button className="btn primary" disabled={!invite.trim()} onClick={sendInvite}>
                  <UserPlus size={16} /> Einladen
                </button>
              </div>
            </div>
          ) : (
            <div className="card col" style={{ gap: 8 }}>
              <h3>Mitglieder verwalten</h3>
              <p className="small faint">Bei einem eigenen Git-Server lädst du Mitglieder in dessen Weboberfläche ein.</p>
            </div>
          )}
          <div className="card col" style={{ gap: 8 }}>
            <h3>So funktioniert's</h3>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
              <li>
                Bevor du ein Level oder Asset bearbeitest: <b>sperren</b> (Übersicht → „Ich arbeite an …“). Mit „Automatisch sperren“
                passiert das beim Speichern von selbst.
              </li>
              <li>Nicht gesperrte Assets sind schreibgeschützt – Unreal fragt dann nach, statt still Arbeit zu überschreiben.</li>
              <li>Beim Hochladen werden deine Sperren automatisch wieder freigegeben.</li>
            </ul>
          </div>
        </div>
      </div>

      {forceAsk && (
        <Modal onClose={() => setForceAsk(null)}>
          <div className="row">
            <ShieldAlert color="var(--danger)" />
            <h2>Fremde Sperre aufheben?</h2>
          </div>
          <p className="muted">
            <b>{forceAsk.owner}</b> arbeitet vielleicht noch an <b>{displayName(forceAsk.path).name}</b>. Wenn du die Sperre aufhebst und
            beide ändern, geht die Arbeit von einem von euch verloren. Am besten vorher kurz fragen!
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setForceAsk(null)}>
              Abbrechen
            </button>
            <button
              className="btn danger"
              onClick={() => {
                const l = forceAsk;
                setForceAsk(null);
                unlock(l, true);
              }}
            >
              Trotzdem aufheben
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
