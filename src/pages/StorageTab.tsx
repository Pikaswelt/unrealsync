import { useEffect, useState } from "react";
import { Cloud, Copy, Eye, EyeOff, HardDrive, MoveRight, Server, Sparkles } from "lucide-react";
import { api, AppSnapshot, errText, StorageInfo } from "../lib/api";
import { bytes } from "../lib/format";
import { Banner, Github, Modal, useUi } from "../components/ui";
import { emptyS3, S3Form, s3Complete, S3Value } from "../components/StorageForm";

export function StorageTab({ snap }: { snap: AppSnapshot }) {
  const { runOp, toast } = useUi();
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [migrate, setMigrate] = useState<"s3" | "lfs" | null>(null);
  const [s3, setS3] = useState<S3Value>(emptyS3());
  const isServer = snap.account?.kind === "server";

  const load = () =>
    api
      .storageInfo()
      .then((i) => {
        setInfo(i);
        if (i.backend === "s3" && i.hasKeys) api.accessCode().then(setCode).catch(() => {});
        else setCode(null);
      })
      .catch((e) => toast(errText(e), "error"));

  useEffect(() => {
    load();
  }, []);

  if (!info) return <div className="page"><div className="empty">Lade Speicherinfos …</div></div>;

  const pct = info.quotaBytes ? Math.min(100, (info.lfsBytes / info.quotaBytes) * 100) : null;
  const backendLabel = { github: "GitHub LFS", server: "Git-Server (LFS)", s3: "Eigener Cloud-Speicher" }[info.backend];
  const BackendIcon = { github: Github, server: Server, s3: Cloud }[info.backend];

  const doMigrate = async () => {
    const target = migrate === "s3" ? { type: "s3" as const, ...s3 } : { type: "lfs" as const };
    setMigrate(null);
    const r = await runOp("Speicher wird umgezogen", () => api.migrate(target));
    if (r !== null) {
      toast("Umzug abgeschlossen! Dein Team wird beim nächsten Holen automatisch umgestellt.", "ok");
      load();
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div className="col" style={{ gap: 4 }}>
          <h1>Speicher</h1>
          <p className="muted">Wo eure großen Dateien liegen und wie viel Platz sie brauchen.</p>
        </div>
      </div>

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card col" style={{ gap: 16 }}>
            <div className="row">
              <div className="file-ic asset" style={{ width: 42, height: 42 }}>
                <BackendIcon size={20} />
              </div>
              <div className="grow">
                <div className="small faint">Aktueller Speicher</div>
                <h2>{backendLabel}</h2>
                {info.location && (
                  <div className="small faint mono ellipsis">
                    {info.location.bucket} @ {info.location.endpoint.replace(/^https?:\/\//, "")}
                    {info.location.prefix ? ` / ${info.location.prefix}` : ""}
                  </div>
                )}
              </div>
            </div>

            <div className="col" style={{ gap: 8 }}>
              <div className="row between">
                <span>
                  <b style={{ fontSize: 22 }}>{bytes(info.lfsBytes)}</b>{" "}
                  <span className="muted">{info.quotaBytes ? `von ${bytes(info.quotaBytes)} gratis` : "belegt"}</span>
                </span>
                <span className="small faint">{info.lfsFiles.toLocaleString("de-DE")} Dateiversionen</span>
              </div>
              {pct != null && (
                <div className={`meter ${pct > 80 ? "warn" : ""}`}>
                  <div style={{ width: `${Math.max(pct, 1)}%` }} />
                </div>
              )}
              <p className="hint">
                Summe aller Versionen großer Dateien im Projektverlauf (ungefähr – so rechnet auch der Anbieter). Lokal auf diesem PC:{" "}
                {bytes(info.localCacheBytes)}.
              </p>
            </div>

            {info.backend === "github" && pct != null && pct > 80 && (
              <Banner kind="warn">
                Ihr nähert euch den 10 GB Gratis-Speicher. Zieht auf einen eigenen Cloud-Speicher um oder gebt bei GitHub unter
                „Billing“ ein Budget für Git LFS frei.
              </Banner>
            )}
            {info.backend === "github" && (
              <Banner kind="info">
                Bei GitHub zählt auch der <b>Download</b> (10 GB/Monat gratis): Jedes Mal, wenn jemand große Dateien holt, wird das
                angerechnet. Cloudflare R2 berechnet Downloads nicht.
              </Banner>
            )}
          </div>

          {info.backend === "s3" && (
            <div className="card col" style={{ gap: 12 }}>
              <h3>Zugangscode fürs Team</h3>
              {code ? (
                <>
                  <p className="small muted">
                    Teammitglieder brauchen diesen Code einmalig, um auf den Cloud-Speicher zuzugreifen. <b>Nur privat teilen</b> (z. B.
                    per Discord-DM) – er enthält eure Speicher-Schlüssel.
                  </p>
                  <div className="kbd-code">{showCode ? code : code.slice(0, 12) + "•".repeat(28)}</div>
                  <div className="row">
                    <button className="btn" onClick={() => setShowCode(!showCode)}>
                      {showCode ? <EyeOff size={15} /> : <Eye size={15} />} {showCode ? "Verbergen" : "Anzeigen"}
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => {
                        navigator.clipboard.writeText(code);
                        toast("Zugangscode kopiert.", "ok");
                      }}
                    >
                      <Copy size={15} /> Kopieren
                    </button>
                  </div>
                </>
              ) : (
                <Banner kind="warn">Auf diesem PC ist noch kein Schlüssel hinterlegt – gib unter „Übersicht“ den Zugangscode ein.</Banner>
              )}
            </div>
          )}
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card col" style={{ gap: 12 }}>
            <h3>Speicher umziehen</h3>
            <p className="small muted">
              Alle großen Dateien (inkl. alter Versionen) werden in den neuen Speicher kopiert. Der Code bleibt, wo er ist. Dein Team wird
              automatisch umgestellt.
            </p>
            {info.backend !== "s3" && (
              <button className="btn" onClick={() => setMigrate("s3")}>
                <Cloud size={16} /> Zu eigenem Cloud-Speicher (R2/B2/S3) <MoveRight size={14} />
              </button>
            )}
            {info.backend === "s3" && (
              <button className="btn" onClick={() => setMigrate("lfs")}>
                {isServer ? <Server size={16} /> : <Github size={16} />} Zurück zu {isServer ? "Git-Server" : "GitHub LFS"} <MoveRight size={14} />
              </button>
            )}
            {info.backend === "s3" && (
              <button className="btn" onClick={() => setMigrate("s3")}>
                <Cloud size={16} /> Anderen Bucket verwenden <MoveRight size={14} />
              </button>
            )}
          </div>

          <div className="card col" style={{ gap: 12 }}>
            <h3>Platz sparen</h3>
            <ul className="small muted" style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 5 }}>
              <li>Nur hochladen, was das Team braucht – Quelldateien (.blend, .psd) wachsen bei jeder Version.</li>
              <li>Marketplace-/Fab-Pakete und Starter Content lieber bei jedem neu hinzufügen statt versionieren.</li>
              <li>Große Test-Assets vor dem Hochladen wieder löschen.</li>
            </ul>
            <button
              className="btn"
              onClick={async () => {
                const r = await runOp("Lokalen Cache aufräumen", () => api.pruneCache());
                if (r !== null) {
                  toast("Alte, bereits hochgeladene Versionen wurden lokal entfernt.", "ok");
                  load();
                }
              }}
            >
              <HardDrive size={16} /> Lokalen Cache aufräumen
            </button>
            <p className="hint">Löscht nur lokale Kopien alter Versionen – im Speicher bleibt alles erhalten.</p>
          </div>
        </div>
      </div>

      {migrate && (
        <Modal wide onClose={() => setMigrate(null)}>
          <div className="row">
            <Sparkles color="var(--accent-2)" />
            <h2>{migrate === "s3" ? "Umzug in eigenen Cloud-Speicher" : `Umzug zu ${isServer ? "Git-Server" : "GitHub LFS"}`}</h2>
          </div>
          <Banner kind="info">
            Dafür werden einmal <b>alle</b> Versionen ({bytes(info.lfsBytes)}) heruntergeladen und wieder hochgeladen. Bei GitHub zählt das
            Herunterladen zum Download-Kontingent. Lade vorher deine eigenen Änderungen hoch.
          </Banner>
          {migrate === "s3" && <S3Form value={s3} onChange={setS3} />}
          <div className="row" style={{ justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setMigrate(null)}>
              Abbrechen
            </button>
            <button className="btn primary" disabled={migrate === "s3" && !s3Complete(s3)} onClick={doMigrate}>
              <MoveRight size={16} /> Jetzt umziehen
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
