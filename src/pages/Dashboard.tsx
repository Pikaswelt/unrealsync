import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ChevronDown, Cloud, History, LayoutDashboard, Plus, RefreshCw, Settings, Users } from "lucide-react";
import { api, AppSnapshot, errText, LockInfo, Status } from "../lib/api";
import { Avatar, useUi } from "../components/ui";
import { SyncTab } from "./SyncTab";
import { TeamTab } from "./TeamTab";
import { HistoryTab } from "./HistoryTab";
import { StorageTab } from "./StorageTab";
import { SettingsTab } from "./SettingsTab";

export type Tab = "sync" | "team" | "history" | "storage" | "settings";

export type ProjectData = {
  status: Status | null;
  locks: LockInfo[];
  refresh: (remote?: boolean) => Promise<void>;
  refreshLocks: () => Promise<void>;
  lastFetch: Date | null;
  fetching: boolean;
};

export function Dashboard({ snap, reload, onAddProject }: { snap: AppSnapshot; reload: () => void; onAddProject: () => void }) {
  const { toast, busy } = useUi();
  const [tab, setTab] = useState<Tab>("sync");
  const [status, setStatus] = useState<Status | null>(null);
  const [locks, setLocks] = useState<LockInfo[]>([]);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [fetching, setFetching] = useState(false);
  const [switcher, setSwitcher] = useState(false);
  const prevBehind = useRef(0);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const project = snap.activeProject!;

  const handleStatus = useCallback(
    (s: Status, fromRemote: boolean) => {
      setStatus(s);
      if (fromRemote && s.behind > prevBehind.current && s.incoming.length) {
        const authors = [...new Set(s.incoming.map((c) => c.author))].join(", ");
        api.notify("Neue Änderungen verfügbar", `${authors}: ${s.incoming[0].message}`).catch(() => {});
      }
      prevBehind.current = s.behind;
    },
    [],
  );

  const refreshLocks = useCallback(async () => {
    try {
      setLocks(await api.locks());
    } catch {
      /* offline – alte Sperren behalten */
    }
  }, []);

  const refresh = useCallback(
    async (remote = false) => {
      if (busyRef.current) return;
      try {
        if (remote) {
          setFetching(true);
          const s = await api.fetchRemote();
          handleStatus(s, true);
          setLastFetch(new Date());
          await refreshLocks();
        } else {
          handleStatus(await api.status(), false);
        }
      } catch (e) {
        if (remote) setLastFetch(null);
        else toast(errText(e), "error");
      } finally {
        setFetching(false);
      }
    },
    [handleStatus, refreshLocks, toast],
  );

  // Startwerte + Intervalle
  useEffect(() => {
    setStatus(null);
    prevBehind.current = 0;
    refresh(false).then(() => refresh(true));
    const local = setInterval(() => refresh(false), 30_000);
    const remote = setInterval(() => refresh(true), 120_000);
    return () => {
      clearInterval(local);
      clearInterval(remote);
    };
  }, [project.path, refresh]);

  // Dateiänderungen / Sperr-Events aus dem Backend
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const uns = [
      listen("fs-changed", () => {
        clearTimeout(t);
        t = setTimeout(() => refresh(false), 1500);
      }),
      listen("locks-changed", () => refreshLocks()),
      listen<string>("auto-locked", (e) => toast(`Automatisch gesperrt: ${e.payload.split("/").pop()} – dein Team sieht, dass du daran arbeitest.`, "info")),
      listen<string>("lock-conflict", (e) => toast(`Achtung: ${e.payload.split("/").pop()} ist von jemand anderem gesperrt!`, "warn")),
    ];
    return () => {
      clearTimeout(t);
      uns.forEach((u) => u.then((f) => f()));
    };
  }, [refresh, refreshLocks, toast]);

  const data: ProjectData = { status, locks, refresh, refreshLocks, lastFetch, fetching };
  const theirLocks = locks.filter((l) => !l.ours).length;
  const acc = snap.account!;

  const nav: [Tab, string, ReactNode, number?][] = [
    ["sync", "Übersicht", <LayoutDashboard size={18} />, (status?.changes.length ?? 0) + (status?.behind ?? 0) || undefined],
    ["team", "Team & Sperren", <Users size={18} />, theirLocks || undefined],
    ["history", "Verlauf", <History size={18} />],
    ["storage", "Speicher", <Cloud size={18} />],
    ["settings", "Einstellungen", <Settings size={18} />],
  ];

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand" style={{ padding: "2px 6px" }}>
          <div className="brand-logo" style={{ width: 32, height: 32 }}>
            <RefreshCw size={17} />
          </div>
          <div className="brand-name">UnrealSync</div>
        </div>

        <div style={{ position: "relative" }}>
          <button className="project-switch" onClick={() => setSwitcher(!switcher)}>
            <div className="grow">
              <div className="small faint">Projekt</div>
              <div className="ellipsis" style={{ fontWeight: 650 }}>
                {project.name}
              </div>
            </div>
            <ChevronDown size={16} className="faint" />
          </button>
          {switcher && (
            <div className="card" style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, padding: 6, zIndex: 20, boxShadow: "var(--shadow)" }}>
              {snap.projects.map((p) => (
                <button
                  key={p.path}
                  className="btn ghost"
                  style={{ width: "100%", justifyContent: "flex-start" }}
                  onClick={async () => {
                    setSwitcher(false);
                    if (p.path === project.path) return;
                    try {
                      const needs = await api.selectProject(p.path);
                      if (needs) toast("Für dieses Projekt fehlt noch der Zugangscode (siehe Übersicht).", "warn");
                    } catch (e) {
                      toast(errText(e), "error");
                    }
                    reload();
                  }}
                >
                  <span className="ellipsis">{p.name}</span>
                </button>
              ))}
              <div className="divider" />
              <button className="btn ghost" style={{ width: "100%", justifyContent: "flex-start" }} onClick={onAddProject}>
                <Plus size={15} /> Projekt hinzufügen
              </button>
            </div>
          )}
        </div>

        <nav className="nav">
          {nav.map(([id, label, icon, count]) => (
            <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {icon}
              {label}
              {count ? <span className={`badge count ${id === "team" ? "warn" : "accent"}`}>{count}</span> : null}
            </button>
          ))}
        </nav>

        <div className="me">
          <Avatar name={acc.name} url={acc.avatarUrl} />
          <div className="grow" style={{ minWidth: 0 }}>
            <div className="ellipsis" style={{ fontWeight: 600 }}>
              {acc.name}
            </div>
            <div className="small faint ellipsis">@{acc.login}</div>
          </div>
        </div>
      </aside>

      <main className="main">
        {tab === "sync" && <SyncTab snap={snap} data={data} goTo={setTab} />}
        {tab === "team" && <TeamTab snap={snap} data={data} />}
        {tab === "history" && <HistoryTab />}
        {tab === "storage" && <StorageTab snap={snap} />}
        {tab === "settings" && <SettingsTab snap={snap} reload={reload} />}
      </main>
    </div>
  );
}
