import { useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { api, CommitInfo, errText } from "../lib/api";
import { ago, displayName } from "../lib/format";
import { Avatar, useUi } from "../components/ui";
import { KindIcon } from "./SyncTab";

const ST: Record<string, [string, string]> = {
  A: ["neu", "teal"],
  M: ["geändert", ""],
  D: ["gelöscht", "danger"],
  R: ["umbenannt", "accent"],
};

function kindOf(p: string) {
  const l = p.toLowerCase();
  if (l.endsWith(".umap")) return "map" as const;
  if (l.endsWith(".uasset")) return "asset" as const;
  if (/\.(cpp|h|hpp|cs)$/.test(l)) return "code" as const;
  if (/\.(ini|uproject|uplugin|json)$/.test(l)) return "config" as const;
  return "other" as const;
}

export function HistoryTab() {
  const { toast } = useUi();
  const [items, setItems] = useState<CommitInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const load = () =>
    api
      .history(200)
      .then(setItems)
      .catch((e) => {
        toast(errText(e), "error");
        setItems([]);
      });
  useEffect(() => {
    load();
  }, []);

  const q = filter.toLowerCase();
  const shown = (items ?? []).filter(
    (c) => !q || c.message.toLowerCase().includes(q) || c.author.toLowerCase().includes(q) || c.files.some(([, f]) => f.toLowerCase().includes(q)),
  );

  return (
    <div className="page">
      <div className="page-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>Verlauf</h1>
          <p className="muted">Alle hochgeladenen Stände – wer hat wann was geändert.</p>
        </div>
        <div className="row">
          <input className="input" style={{ width: 260 }} placeholder="Suchen (Text, Person, Datei) …" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn icon" onClick={load}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <div className="card tight">
        {items === null && <div className="empty">Lade …</div>}
        {items && shown.length === 0 && (
          <div className="empty">
            <History size={30} /> Nichts gefunden.
          </div>
        )}
        <div className="timeline">
          {shown.map((c) => (
            <div key={c.hash} className="tl-item" onClick={() => setOpen(open === c.hash ? null : c.hash)}>
              <Avatar name={c.author} />
              <div style={{ minWidth: 0 }}>
                <div className="row between">
                  <b className="ellipsis">{c.message}</b>
                  <span className="small faint" style={{ flex: "none" }}>
                    {ago(c.date)}
                  </span>
                </div>
                <div className="small faint">
                  {c.author} · {c.files.length} Datei{c.files.length === 1 ? "" : "en"} · <span className="mono">{c.short}</span>
                </div>
                {open === c.hash && (
                  <div className="tl-files">
                    {c.files.map(([s, f]) => {
                      const [label, cls] = ST[s] ?? ["geändert", ""];
                      const { name, dir } = displayName(f);
                      return (
                        <div key={f} className="row small" style={{ gap: 8 }}>
                          <div style={{ transform: "scale(.8)" }}>
                            <KindIcon kind={kindOf(f)} />
                          </div>
                          <span style={{ fontWeight: 600 }}>{name}</span>
                          <span className="faint mono ellipsis grow">{dir}</span>
                          <span className={`badge ${cls}`}>{label}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
