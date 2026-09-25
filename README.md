# UnrealSync

Desktop-App (Tauri 2, Windows), mit der ein Team ein Unreal-Projekt über GitHub teilt – ohne Git-Kommandos.
Einmal einrichten, danach nur noch **Änderungen holen**, **Hochladen** und sehen, **wer woran arbeitet**.

## So funktioniert's

- **Ein Hauptstand (`main`) + Sperren.** Unreal-Assets (`.uasset`, `.umap`) lassen sich nicht zusammenführen.
  Deshalb werden sie über Git LFS gespeichert und sind *sperrbar*: Wer ein Asset bearbeitet, sperrt es –
  alle anderen sehen das unter „Team & Sperren“. Nicht gesperrte Assets sind schreibgeschützt, Unreal fragt dann nach,
  statt still Arbeit zu überschreiben.
- **Automatisch sperren:** Speicherst du ein Asset in Unreal, sperrt UnrealSync es für dich (abschaltbar).
  Hat jemand anderes es gesperrt, kommt sofort eine Windows-Benachrichtigung.
- **Hochladen:** Dateien auswählen, kurz beschreiben, fertig. Vorher werden die Team-Änderungen geholt,
  danach werden deine Sperren freigegeben.
- **Holen ist sicher:** Große Dateien werden *vor* jeder Änderung am Projektordner vollständig geladen.
  Lokale Änderungen werden nie überschrieben – überschneidet sich etwas, fragt die App pro Datei nach.
- **Unreal offen?** Die App warnt vor dem Holen (sonst überschreibt Unreal neue Dateien wieder).

## Speicher für große Dateien (im Setup wählbar, später umziehbar)

| Option | Kosten | Hinweis |
|---|---|---|
| **GitHub LFS** | 10 GB Speicher + 10 GB Download/Monat gratis, danach pro GB | Null Einrichtung |
| **Eigener Cloud-Speicher** (Cloudflare R2, Backblaze B2, S3) | R2: 10 GB gratis, **Downloads kostenlos** | Code bleibt auf GitHub. Teammitglieder brauchen einmal den Zugangscode (unter „Speicher“) |
| **Eigener Git-Server** (Forgejo/Gitea/GitLab) | eigene Hardware | Anmeldung mit Server-URL + Token |

„Speicher umziehen“ kopiert alle Versionen in den neuen Speicher und stellt das Team automatisch um.
Die S3-Anbindung läuft ohne eigenen Server: Git LFS startet `UnrealSync.exe lfs-agent …` als Transfer-Agent.

## Einrichten

**Person 1 (lädt das Projekt hoch):** Installer ausführen → mit GitHub anmelden → „Neues Projekt hochladen“ →
Projektordner wählen → Speicher wählen → GitHub-Namen des Freundes eintragen → „Projekt hochladen“.

**Person 2 (tritt bei):** Installer ausführen → mit GitHub anmelden → „Projekt beitreten“ → Einladung annehmen →
Speicherort wählen → „Herunterladen“ (bei Cloud-Speicher: Zugangscode eingeben).

> ⚠️ Das Unreal-Projekt **nicht in OneDrive/Dropbox** ablegen – deren Synchronisation sperrt und beschädigt
> Git- und Unreal-Dateien. Die App warnt davor.

### GitHub-Anmeldung

- **Ohne weitere Einrichtung:** Persönliches Token (Classic, Scope `repo`) – die App verlinkt die passende GitHub-Seite.
- **Bequemer Browser-Login (optional):** Auf GitHub unter *Settings → Developer settings → OAuth Apps → New OAuth App*
  eine App anlegen (Homepage/Callback beliebig, z. B. `https://github.com`), **„Enable Device Flow“** anhaken und die
  **Client-ID** in der App unter *Einstellungen* eintragen – oder beim Bauen fest einbauen:
  `set UNREALSYNC_GITHUB_CLIENT_ID=Ov23li…` vor `npm run tauri build`.

Tokens und Speicher-Schlüssel liegen in der Windows-Anmeldeinformationsverwaltung, nie im Repo.

## Entwickeln & bauen

Voraussetzungen: Node 20+, Rust (stable), WebView2 (bei Windows 11 dabei).

```bash
npm install
npm run fetch-git        # einmalig: MinGit + Git LFS nach src-tauri/resources/mingit (für den Installer)
npm run tauri dev        # App im Entwicklungsmodus
npm run tauri build      # Installer: <target>/release/bundle/nsis/UnrealSync_x.y.z_x64-setup.exe
cd src-tauri && cargo test --lib
```

Liegt der Quellcode in OneDrive, die Rust-Build-Ausgabe auslagern – OneDrive sperrt sonst Dateien während des Builds.
Dazu `src-tauri/.cargo/config.toml` anlegen (wird nicht eingecheckt):

```toml
[build]
target-dir = "C:/Users/<du>/AppData/Local/UnrealSync-build/target"
```

## Aufbau

```
src/                     React-Oberfläche (Setup-Assistent, Übersicht, Team, Verlauf, Speicher, Einstellungen)
src-tauri/src/
  git.rs                 Git/LFS-Aufrufe ohne Konsolenfenster, Token per Umgebungsvariable, Fortschritt
  github.rs              Anmeldung (Device Flow / Token), Repo anlegen, Einladungen, Mitglieder
  project.rs             Hochladen/Beitreten, .gitignore/.gitattributes, .unrealsync.json, Speicher-Konfiguration
  sync.rs                Status, sicheres Holen, Hochladen, Konflikte, Verlauf
  locks.rs               Git-LFS-Sperren
  watcher.rs             Dateiwächter: Auto-Sperren + Warnungen
  storage.rs             Speicheranzeige, Umzug, Zugangscode
  s3.rs / lfs_agent.rs   S3-Client (SigV4) + Git-LFS-Transfer-Agent
```

## Lizenz

MIT – siehe [LICENSE](LICENSE).
