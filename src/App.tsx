import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api, AppSnapshot, errText } from "./lib/api";
import { UiProvider } from "./components/ui";
import { Setup } from "./pages/Setup";
import { Dashboard } from "./pages/Dashboard";

export default function App() {
  const [snap, setSnap] = useState<AppSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(() => {
    api
      .appState()
      .then((s) => {
        setSnap(s);
        setError(null);
      })
      .catch((e) => setError(errText(e)));
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  return (
    <UiProvider>
      {error && <div className="empty">{error}</div>}
      {!snap && !error && (
        <div className="empty" style={{ height: "100%" }}>
          <RefreshCw className="spin" size={28} />
        </div>
      )}
      {snap &&
        (!snap.account || !snap.activeProject || adding ? (
          <Setup
            snap={snap}
            onCancel={adding && snap.activeProject && snap.account ? () => setAdding(false) : undefined}
            onDone={() => {
              setAdding(false);
              reload();
            }}
          />
        ) : (
          <Dashboard key={snap.activeProject.path} snap={snap} reload={reload} onAddProject={() => setAdding(true)} />
        ))}
    </UiProvider>
  );
}
