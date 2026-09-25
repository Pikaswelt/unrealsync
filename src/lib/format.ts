export function bytes(n: number | null | undefined): string {
  if (n == null) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1).replace(".", ",")} ${units[i]}`;
}

export function ago(iso: string): string {
  const t = new Date(iso).getTime();
  if (!t) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "gerade eben";
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.floor(s / 3600)} Std.`;
  if (s < 86400 * 7) {
    const d = Math.floor(s / 86400);
    return d === 1 ? "gestern" : `vor ${d} Tagen`;
  }
  return new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}

export function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

/** Anzeigename: Unreal-Assetpfad bevorzugt, sonst Dateiname */
export function displayName(path: string): { name: string; dir: string } {
  const p = path.replace(/\.(uasset|umap)$/i, "");
  const parts = p.split("/");
  const name = parts.pop() ?? p;
  let dir = parts.join("/");
  if (dir.startsWith("Content")) dir = "/Game" + dir.slice("Content".length);
  return { name, dir };
}

export function initials(name: string): string {
  return name
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}

export function isOneDrive(path: string): boolean {
  return /[\\/]onedrive/i.test(path);
}
