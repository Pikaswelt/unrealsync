// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Git LFS startet dieselbe EXE als Transfer-Agent für S3-Speicher:
    //   UnrealSync.exe lfs-agent <base64-config>
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("lfs-agent") {
        let code = unrealsync_lib::lfs_agent::run(args.get(2).map(String::as_str).unwrap_or(""));
        std::process::exit(code);
    }
    // Nur Debug-Builds: Schlüssel für automatisierte Tests hinterlegen
    #[cfg(debug_assertions)]
    if args.get(1).map(String::as_str) == Some("store-secret") && args.len() == 4 {
        unrealsync_lib::settings::secrets::set(&args[2], &args[3]).expect("secret");
        return;
    }
    unrealsync_lib::run()
}
