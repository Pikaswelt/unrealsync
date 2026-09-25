import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Box,
  CheckCircle2,
  Code2,
  FileCog,
  FileQuestion,
  FolderOpen,
  Gamepad2,
  Lock,
  LockOpen,
  Map as MapIcon,
  RefreshCw,
  Search,
  Undo2,
} from "lucide-react";
import { api, AppSnapshot, Change, SyncResult } from "../lib/api";
import { ago, bytes, displayName } from "../lib/format";
import { Banner, Modal, Toggle, useUi } from "../components/ui";
import { AccessCodeStep } from "./Setup";
import type { ProjectData, Tab } from "./Dashboard";

const KIND_ORDER: Change["kind"][] = ["map", "asset", "code", "config", "other"];
const KIND_LABEL: Record<Change["kind"], string> = {
  map: "Level",
  asset: "Assets",
  code: "Code",
  config: "Einstellungen",
  other: "Sonstige Dateien",
};
const STATUS_LABEL: Record<Change["status"], string> = {
  modified: "geändert",
  added: "neu",
  deleted: "gelöscht",
  renamed: "umbenannt",
  conflict: "Konflikt",
};

export function KindIcon({ kind }: { kind: Change["kind"] }) {
  const Icon = { map: MapIcon, asset: Box, code: Code2, config: FileCog, other: FileQuestion }[kind];
  return (
    <div className={`file-ic ${kind}`}>
      <Icon size={16} />
    </div>
  );
}

export function SyncTab({ snap, data, goTo }: { snap: AppSnapshot; data: ProjectData; goTo: (t: Tab) => void }) {
  const { runOp, toast } = useUi();
  const { status, locks, refresh, refreshLocks, lastFetch, fetching } = data;
  const project = snap.activeProject!;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const [releaseLocks, setReleaseLocks] = useState(true);
  const [unrealWarn, setUnrealWarn] = useState(false);
  const [discardAsk, setDiscardAsk] = useState<string[] | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);
  const msgRef = useRef<HTMLTextAreaElement>(null);
  const knownPaths = useRef<Set<string>>(new Set());

  const changes = status?.changes.filter((c) => c.status !== "conflict") ?? [];

  // Neue Änderungen automatisch vorauswählen
  useEffect(() => {
    if (!status) return;
    setSelected((prev) => {
      const next = new Set<string>();
      for (const c of changes) {
        if (prev.has(c.path) || !knownPaths.current.has(c.path)) next.add(c.path);
      }
      knownPaths.current = new Set(changes.map((c) => c.path));
      return next;
    });
    if (status.conflicts.length) setConflicts(status.conflicts);
    else if (!status.rebaseInProgress) setConflicts([]);
  }, [status]);

  const lockOf = useMemo(() => new Map(locks.map((l) => [l.path, l])), [locks]);
  const groups = useMemo(() => {
    const g = new Map<Change["kind"], Change[]>();
    for (const c of changes) g.set(c.kind, [...(g.get(c.kind) ?? []), c]);
    return KIND_ORDER.filter((k) => g.has(k)).map((k) => [k, g.get(k)!.sort((a, b) => a.path.localeCompare(b.path))] as const);
  }, [changes]);

  const selectedChanges = changes.filter((c) => selected.has(c.path));
  const blocked = selectedChanges.filter((c) => lockOf.get(c.path) && !lockOf.get(c.path)!.ours);
  const big = selectedChanges.filter((c) => (c.size ?? 0) > 100 * 1024 * 1024);

  const handleResult = async (r: SyncResult | null) => {
    if (!r) {
      await refresh(false);
      return;
    }
    if (r.result === "conflict") {
      setConflicts(r.conflicts);
      toast(r.message, "warn");
    } else {
      toast(r.message, "ok");
    }
    await refresh(false);
    await refreshLocks();
  };

  const pull = async (force: boolean) => {
    setUnrealWarn(false);
    try {
      const r = await runOp("Änderungen holen", () => api.pull(force), { silentError: true });
      await handleResult(r);
    } catch (e) {
      if (String(e).includes("UNREAL_RUNNING")) setUnrealWarn(true);
      else toast(String(e), "error");
    }
  };

  const upload = async () => {
    const r = await runOp("Hochladen", () => api.upload([...selected], message, !releaseLocks));
    if (r?.result === "done") setMessage("");
    await handleResult(r);
  };

  const pushOnly = async () => {
    const r = await runOp("Hochladen", () => api.upload([], "", true));
    await handleResult(r);
  };

  const toggle = (p: string) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  const toggleGroup = (items: readonly Change[]) =>
    setSelected((s) => {
      const n = new Set(s);
      const all = items.every((c) => n.has(c.path));
      items.forEach((c) => (all ? n.delete(c.path) : n.add(c.path)));
      return n;
    });

  if (!status) {
    return (
      <div className="page">
        <div className="empty">
          <RefreshCw className="spin" size={28} /> Lade Projektstatus …
        </div>
      </div>
    );
  }

  const behind = status.behind;
  const ahead = status.ahead;

  return (
    <div className="page">
      <div className="page-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>{project.name}</h1>
          <div className="row small faint">
            <span className="mono ellipsis" style={{ maxWidth: 420 }}>
              {project.path}
            </span>
            <span>·</span>
            <span>{fetching ? "prüfe Server …" : lastFetch ? `geprüft ${ago(lastFetch.toISOString())}` : "offline?"}</span>
          </div>
        </div>
        <div className="row">
          <button className="btn" onClick={() => api.openPath(project.path)}>
            <FolderOpen size={16} /> Ordner
          </button>
          <button className="btn" onClick={() => api.openUnreal().catch((e) => toast(String(e), "error"))}>
            <Gamepad2 size={16} /> In Unreal öffnen
          </button>
          <button className="btn icon" title="Jetzt auf Änderungen prüfen" onClick={() => refresh(true)} disabled={fetching}>
            <RefreshCw size={16} className={fetching ? "spin" : ""} />
          </button>
        </div>
      </div>

      {status.needsAccessCode && <AccessCodeStep onDone={() => refresh(false)} />}

      {(conflicts.length > 0 || status.rebaseInProgress) && (
        <ConflictPanel conflicts={conflicts} setConflicts={setConflicts} lockOwner={(p) => lockOf.get(p)?.owner} onDone={handleResult} />
      )}

      {status.unrealRunning && (
        <Banner kind="info" icon={<Gamepad2 size={17} />}>
          Unreal ist gerade geöffnet. Zum <b>Hochladen</b> einfach vorher speichern (Strg+Shift+S). Zum <b>Holen</b> bitte Unreal
          schließen, sonst überschreibt Unreal die neuen Dateien wieder.
        </Banner>
      )}

      <div className="hero">
        <div className="hero-card pull">
          <div className="row between">
            <div className="row">
              <ArrowDownToLine size={20} color="var(--teal)" />
              <h3>Vom Team</h3>
            </div>
            {behind === 0 && <span className="badge teal">aktuell</span>}
          </div>
          <div className="row" style={{ alignItems: "baseline" }}>
            <span className="hero-num">{behind}</span>
            <span className="muted">{behind === 1 ? "neue Änderung" : "neue Änderungen"}</span>
          </div>
          <div className="col" style={{ gap: 4, minHeight: 44 }}>
            {status.incoming.slice(0, 3).map((c) => (
              <div key={c.hash} className="small ellipsis">
                <b>{c.author}</b> <span className="muted">{c.message}</span> <span className="faint">· {ago(c.date)}</span>
              </div>
            ))}
            {behind === 0 && <div className="small faint">Du hast den neuesten Stand.</div>}
          </div>
          <div>
            <button className="btn teal" onClick={() => pull(false)} disabled={!status.hasUpstream}>
              <ArrowDownToLine size={16} /> Änderungen holen
            </button>
          </div>
        </div>

        <div className="hero-card push">
          <div className="row between">
            <div className="row">
              <ArrowUpFromLine size={20} color="var(--accent-2)" />
              <h3>Von dir</h3>
            </div>
            {ahead > 0 && <span className="badge warn">{ahead} noch nicht hochgeladen</span>}
          </div>
          <div className="row" style={{ alignItems: "baseline" }}>
            <span className="hero-num">{changes.length}</span>
            <span className="muted">{changes.length === 1 ? "geänderte Datei" : "geänderte Dateien"}</span>
          </div>
          <div className="small faint" style={{ minHeight: 44 }}>
            {changes.length
              ? "Wähle unten aus, was hochgeladen werden soll, und beschreibe kurz deine Änderung."
              : ahead
                ? "Du hast gespeicherte Stände, die noch nicht hochgeladen sind."
                : "Keine lokalen Änderungen."}
          </div>
          <div className="row">
            {changes.length > 0 && (
              <button className="btn primary" onClick={() => msgRef.current?.focus()}>
                <ArrowUpFromLine size={16} /> Hochladen …
              </button>
            )}
            {!changes.length && ahead > 0 && (
              <button className="btn primary" onClick={pushOnly}>
                <ArrowUpFromLine size={16} /> Jetzt hochladen
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card tight">
          <div className="card-head">
            <h3 className="grow">Deine Änderungen</h3>
            {changes.length > 0 && (
              <>
                <button className="btn ghost sm" onClick={() => setSelected(new Set(changes.map((c) => c.path)))}>
                  Alle
                </button>
                <button className="btn ghost sm" onClick={() => setSelected(new Set())}>
                  Keine
                </button>
                <button className="btn ghost sm" disabled={!selected.size} onClick={() => setDiscardAsk([...selected])}>
                  <Undo2 size={14} /> Verwerfen
                </button>
              </>
            )}
          </div>
          {changes.length === 0 ? (
            <div className="empty">
              <CheckCircle2 size={34} />
              Alles hochgeladen. Arbeite in Unreal – geänderte Dateien erscheinen hier automatisch.
            </div>
          ) : (
            <div className="list" style={{ maxHeight: 520, overflow: "auto" }}>
              {groups.map(([kind, items]) => (
                <div key={kind}>
                  <div className="list-group">
                    <input type="checkbox" className="check" checked={items.every((c) => selected.has(c.path))} onChange={() => toggleGroup(items)} />
                    {KIND_LABEL[kind]} <span className="faint">({items.length})</span>
                  </div>
                  {items.map((c) => (
                    <ChangeRow key={c.path} c={c} checked={selected.has(c.path)} onToggle={() => toggle(c.path)} lock={lockOf.get(c.path)} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card col" style={{ gap: 12 }}>
            <h3>Hochladen</h3>
            <textarea
              ref={msgRef}
              className="input"
              rows={3}
              placeholder="Was hast du gemacht? z. B. „Neues Level Wüste + Gegner-KI angepasst“"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && e.ctrlKey && selected.size && message.trim()) upload();
              }}
            />
            <Toggle checked={releaseLocks} onChange={setReleaseLocks} label={<span className="small">Meine Sperren danach freigeben</span>} />
            {blocked.length > 0 && (
              <Banner kind="danger">
                {blocked.length === 1 ? "Eine Datei ist" : `${blocked.length} Dateien sind`} von{" "}
                <b>{[...new Set(blocked.map((b) => lockOf.get(b.path)!.owner))].join(", ")}</b> gesperrt und können nicht hochgeladen
                werden. Abwählen oder im Team absprechen.
              </Banner>
            )}
            {big.length > 0 && (
              <Banner kind="warn">
                {big.length} Datei(en) über 100 MB ausgewählt ({bytes(big.reduce((a, c) => a + (c.size ?? 0), 0))}). Das kostet Speicher –
                wirklich hochladen?
              </Banner>
            )}
            <button className="btn primary big" disabled={!selected.size || !message.trim()} onClick={upload}>
              <ArrowUpFromLine size={18} /> {selected.size ? `${selected.size} Datei${selected.size === 1 ? "" : "en"} hochladen` : "Nichts ausgewählt"}
            </button>
            <p className="hint">Tipp: Strg+Enter lädt hoch. Vorher werden automatisch die neuesten Änderungen vom Team geholt.</p>
          </div>

          <LockBox data={data} goTo={goTo} />
        </div>
      </div>

      {unrealWarn && (
        <Modal onClose={() => setUnrealWarn(false)}>
          <div className="row">
            <AlertTriangle color="var(--warn)" />
            <h2>Unreal ist noch geöffnet</h2>
          </div>
          <p className="muted">
            Wenn du jetzt Änderungen holst, während Unreal läuft, kann Unreal die neuen Dateien beim Speichern wieder überschreiben
            oder Assets falsch laden. Speichere, schließe Unreal und versuche es dann nochmal.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => pull(true)}>
              Trotzdem holen
            </button>
            <button className="btn primary" onClick={() => setUnrealWarn(false)}>
              OK, ich schließe Unreal
            </button>
          </div>
        </Modal>
      )}

      {discardAsk && (
        <Modal onClose={() => setDiscardAsk(null)}>
          <div className="row">
            <Undo2 color="var(--danger)" />
            <h2>Änderungen verwerfen?</h2>
          </div>
          <p className="muted">
            {discardAsk.length} Datei(en) werden auf den letzten hochgeladenen Stand zurückgesetzt. Neue Dateien werden gelöscht. Das
            lässt sich <b>nicht</b> rückgängig machen.
          </p>
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setDiscardAsk(null)}>
              Abbrechen
            </button>
            <button
              className="btn danger"
              onClick={async () => {
                const paths = discardAsk;
                setDiscardAsk(null);
                const ok = await runOp("Verwerfen", () => api.discard(paths));
                if (ok !== null) toast("Änderungen verworfen.", "ok");
                refresh(false);
              }}
            >
              Endgültig verwerfen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ChangeRow({ c, checked, onToggle, lock }: { c: Change; checked: boolean; onToggle: () => void; lock?: { owner: string; ours: boolean } }) {
  const { name, dir } = displayName(c.path);
  return (
    <div className="list-item" onClick={onToggle} style={{ cursor: "pointer" }}>
      <input type="checkbox" className="check" checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} />
      <KindIcon kind={c.kind} />
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className={`status-dot ${c.status}`} />
          <span className="ellipsis" style={{ fontWeight: 600 }}>
            {name}
          </span>
        </div>
        <div className="small faint ellipsis mono">{c.asset ? dir : c.path}</div>
      </div>
      {(c.size ?? 0) > 100 * 1024 * 1024 && <span className="badge warn">{bytes(c.size)}</span>}
      {lock && (
        <span className={`badge ${lock.ours ? "teal" : "danger"}`} title={lock.ours ? "Von dir gesperrt" : `Gesperrt von ${lock.owner}`}>
          <Lock size={11} /> {lock.ours ? "du" : lock.owner}
        </span>
      )}
      <span className="badge">{STATUS_LABEL[c.status]}</span>
    </div>
  );
}

function LockBox({ data, goTo }: { data: ProjectData; goTo: (t: Tab) => void }) {
  const { runOp } = useUi();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<string[]>([]);
  const mine = data.locks.filter((l) => l.ours);
  const others = data.locks.filter((l) => !l.ours);
  const lockOf = new Map(data.locks.map((l) => [l.path, l]));

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => api.listAssets(q).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const lock = async (p: string) => {
    await runOp("Sperren", () => api.lock([p]));
    await data.refreshLocks();
  };
  const unlock = async (p: string) => {
    await runOp("Freigeben", () => api.unlock([p], false));
    await data.refreshLocks();
  };

  return (
    <div className="card col" style={{ gap: 12 }}>
      <div className="row between">
        <h3>Ich arbeite an …</h3>
        {others.length > 0 && (
          <a className="small" onClick={() => goTo("team")}>
            {others.length} vom Team gesperrt →
          </a>
        )}
      </div>
      <p className="small faint">Sperre ein Asset, bevor du es bearbeitest – dann kann niemand gleichzeitig daran arbeiten.</p>
      <div className="row" style={{ position: "relative" }}>
        <Search size={16} className="faint" style={{ position: "absolute", left: 11 }} />
        <input className="input" style={{ paddingLeft: 34 }} placeholder="Asset suchen, z. B. Level1" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {results.length > 0 && (
        <div className="card tight" style={{ maxHeight: 220, overflow: "auto" }}>
          {results.map((p) => {
            const l = lockOf.get(p);
            const { name, dir } = displayName(p);
            return (
              <div key={p} className="list-item" style={{ minHeight: 42, padding: "6px 12px" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="ellipsis small" style={{ fontWeight: 600 }}>
                    {name}
                  </div>
                  <div className="ellipsis small faint mono">{dir}</div>
                </div>
                {l ? (
                  <span className={`badge ${l.ours ? "teal" : "danger"}`}>
                    <Lock size={11} /> {l.ours ? "du" : l.owner}
                  </span>
                ) : (
                  <button className="btn sm" onClick={() => lock(p)}>
                    <Lock size={13} /> Sperren
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
      {mine.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="small faint">Von dir gesperrt</div>
          {mine.map((l) => (
            <div key={l.id} className="row small">
              <Lock size={13} color="var(--teal)" />
              <span className="grow ellipsis">{displayName(l.path).name}</span>
              <button className="btn ghost sm" onClick={() => unlock(l.path)}>
                <LockOpen size={13} /> Freigeben
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ConflictPanel({
  conflicts,
  setConflicts,
  lockOwner,
  onDone,
}: {
  conflicts: string[];
  setConflicts: (c: string[]) => void;
  lockOwner: (p: string) => string | undefined;
  onDone: (r: SyncResult | null) => void;
}) {
  const { runOp, toast } = useUi();
  const resolve = async (p: string, keep: "mine" | "theirs") => {
    const rest = await runOp("Konflikt lösen", () => api.resolveConflict(p, keep));
    if (rest) setConflicts(rest);
  };
  return (
    <div className="card col" style={{ gap: 12, borderColor: "rgba(245,158,11,.45)" }}>
      <div className="row">
        <AlertTriangle color="var(--warn)" />
        <h3 className="grow">Gleichzeitig geändert – welche Version soll bleiben?</h3>
      </div>
      <p className="small muted">
        Diese Dateien wurden von dir <b>und</b> jemand anderem geändert. Unreal-Assets lassen sich nicht zusammenführen – wähle pro Datei
        eine Version. Tipp: Sperren verhindern das künftig.
      </p>
      {conflicts.map((p) => (
        <div key={p} className="row">
          <KindIcon kind={p.endsWith(".umap") ? "map" : p.endsWith(".uasset") ? "asset" : "other"} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>
              {displayName(p).name}
            </div>
            <div className="small faint mono ellipsis">{p}</div>
          </div>
          <button className="btn sm" onClick={() => resolve(p, "mine")}>
            Meine behalten
          </button>
          <button className="btn sm" onClick={() => resolve(p, "theirs")}>
            Version {lockOwner(p) ? `von ${lockOwner(p)}` : "vom Team"}
          </button>
        </div>
      ))}
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button
          className="btn ghost"
          onClick={async () => {
            await runOp("Abbrechen", () => api.abortSync());
            setConflicts([]);
            toast("Abgebrochen – dein Stand ist wie vorher.", "info");
            onDone(null);
          }}
        >
          Abbrechen
        </button>
        <button className="btn primary" disabled={conflicts.length > 0} onClick={async () => onDone(await runOp("Abschließen", () => api.continueAfterConflicts()))}>
          Abschließen &amp; hochladen
        </button>
      </div>
    </div>
  );
}
