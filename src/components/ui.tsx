import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import { errText, OpProgress } from "../lib/api";
import { initials } from "../lib/format";

type ToastKind = "info" | "ok" | "error" | "warn";
type Toast = { id: number; kind: ToastKind; text: string };

type UiCtx = {
  toast: (text: string, kind?: ToastKind) => void;
  /** Führt einen langen Vorgang mit Fortschritts-Overlay aus. Gibt null bei Fehler zurück. */
  runOp: <T>(title: string, fn: () => Promise<T>, opts?: { silentError?: boolean }) => Promise<T | null>;
  busy: boolean;
};

const Ctx = createContext<UiCtx>(null!);
export const useUi = () => useContext(Ctx);

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [op, setOp] = useState<{ title: string; progress: OpProgress | null } | null>(null);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: ToastKind = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t, { id, kind, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 12000 : 5000);
  }, []);

  useEffect(() => {
    const un = listen<OpProgress>("op-progress", (e) => {
      setOp((cur) => (cur ? { ...cur, progress: e.payload } : cur));
    });
    return () => {
      un.then((f) => f());
    };
  }, []);

  const runOp = useCallback(
    async <T,>(title: string, fn: () => Promise<T>, opts?: { silentError?: boolean }) => {
      setOp({ title, progress: null });
      try {
        return await fn();
      } catch (e) {
        if (!opts?.silentError) toast(errText(e), "error");
        else throw e;
        return null;
      } finally {
        setOp(null);
      }
    },
    [toast],
  );

  return (
    <Ctx.Provider value={{ toast, runOp, busy: !!op }}>
      {children}
      {op && <ProgressOverlay title={op.title} p={op.progress} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "ok" ? (
              <CheckCircle2 size={18} color="var(--teal)" />
            ) : t.kind === "error" ? (
              <XCircle size={18} color="var(--danger)" />
            ) : t.kind === "warn" ? (
              <AlertTriangle size={18} color="var(--warn)" />
            ) : (
              <Info size={18} color="var(--accent-2)" />
            )}
            <div className="grow">{t.text}</div>
            <button className="btn ghost icon sm" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

function ProgressOverlay({ title, p }: { title: string; p: OpProgress | null }) {
  const pct = p?.percent ?? null;
  return (
    <div className="overlay">
      <div className="modal" style={{ width: 480 }}>
        <div className="row">
          <Loader2 className="spin" size={22} color="var(--accent-2)" />
          <h2>{title}</h2>
        </div>
        <div className="col" style={{ gap: 8 }}>
          <div className="row between small">
            <span>{p?.step || "Bitte warten …"}</span>
            {pct != null && <span className="muted">{Math.round(pct)} %</span>}
          </div>
          <div className={`progress ${pct == null ? "indeterminate" : ""}`}>
            <div style={{ width: `${pct ?? 0}%` }} />
          </div>
          <div className="small faint ellipsis" style={{ minHeight: 19 }}>
            {p?.message}
          </div>
        </div>
        <p className="small faint">Du kannst das Fenster offen lassen – bei großen Projekten dauert das eine Weile.</p>
      </div>
    </div>
  );
}

export function Modal({ children, onClose, wide }: { children: ReactNode; onClose?: () => void; wide?: boolean }) {
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? "wide" : ""}`}>{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" />
      {label && <span>{label}</span>}
    </label>
  );
}

export function Avatar({ name, url, lg }: { name: string; url?: string | null; lg?: boolean }) {
  return <div className={`avatar ${lg ? "lg" : ""}`}>{url ? <img src={url} alt="" /> : initials(name) || "?"}</div>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}

export function Banner({ kind, children, icon }: { kind: "warn" | "danger" | "info" | "ok"; children: ReactNode; icon?: ReactNode }) {
  return (
    <div className={`banner ${kind}`}>
      {icon ?? (kind === "ok" ? <CheckCircle2 size={17} /> : kind === "info" ? <Info size={17} /> : <AlertTriangle size={17} />)}
      <div className="grow">{children}</div>
    </div>
  );
}

/** GitHub-Symbol (lucide-react enthält ab v1 keine Marken-Icons mehr) */
export function Github({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.65.5.5 5.65.5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.7 5.39-5.26 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z" />
    </svg>
  );
}
