# Lädt MinGit (portables Git für Windows) + Git LFS nach src-tauri/resources/mingit,
# damit der Installer Git mitliefert. Wird übersprungen, wenn schon vorhanden.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Join-Path $PSScriptRoot "..\src-tauri\resources\mingit"
if ((Test-Path "$root\cmd\git.exe") -and (Test-Path "$root\mingw64\bin\git-lfs.exe")) {
    Write-Host "MinGit + Git LFS bereits vorhanden: $root"
    exit 0
}

$tmp = Join-Path $env:TEMP "unrealsync-fetch-git"
Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $tmp | Out-Null
$headers = @{ "User-Agent" = "UnrealSync-Build" }

function Get-LatestAsset($repo, $pattern) {
    $rel = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers $headers
    $asset = $rel.assets | Where-Object { $_.name -match $pattern } | Select-Object -First 1
    if (-not $asset) { throw "Kein Download für $repo ($pattern) gefunden" }
    return $asset
}

Write-Host "Lade MinGit ..."
$mg = Get-LatestAsset "git-for-windows/git" '^MinGit-[\d.]+-64-bit\.zip$'
Invoke-WebRequest $mg.browser_download_url -OutFile "$tmp\mingit.zip" -Headers $headers
Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
Expand-Archive "$tmp\mingit.zip" -DestinationPath $root

Write-Host "Lade Git LFS ..."
$lfs = Get-LatestAsset "git-lfs/git-lfs" '^git-lfs-windows-amd64-v[\d.]+\.zip$'
Invoke-WebRequest $lfs.browser_download_url -OutFile "$tmp\lfs.zip" -Headers $headers
Expand-Archive "$tmp\lfs.zip" -DestinationPath "$tmp\lfs"
$exe = Get-ChildItem "$tmp\lfs" -Recurse -Filter "git-lfs.exe" | Select-Object -First 1
Copy-Item $exe.FullName "$root\mingw64\bin\git-lfs.exe"

Remove-Item $tmp -Recurse -Force
Write-Host "Fertig: $($mg.name) + $($lfs.name) -> $root"
& "$root\cmd\git.exe" --version
& "$root\cmd\git.exe" lfs version
