# Package QuickDeck for Windows into artifacts/: the tauri-built NSIS setup.exe + a
# portable .zip of the self-contained release exe. `tauri build` produces the
# setup.exe; this script runs it and collects the outputs. Output goes to
# artifacts/, NOT dist/ (dist/ is Vite's frontend build dir). Assumes node_modules
# and a Rust toolchain are present (the workflow installs them).
$ErrorActionPreference = "Stop"
$Repo = Split-Path -Parent $PSScriptRoot
Set-Location $Repo

$AppName = "QuickDeck"
$Version = (node -p "require('./src-tauri/tauri.conf.json').version")
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($Version)) { throw "Could not read the application version" }
$TauriCli = Join-Path $Repo "node_modules/.bin/tauri.cmd"
$NsisDirectory = Join-Path $Repo "src-tauri/target/release/bundle/nsis"
$PortableExecutable = Join-Path $Repo "src-tauri/target/release/quickdeck.exe"

if (-not (Test-Path -PathType Leaf $TauriCli)) {
    throw "Missing local Tauri CLI. Run npm install before packaging."
}

# Collect only outputs made by this invocation, keeping Cargo's build cache.
foreach ($output in @("artifacts", $NsisDirectory, $PortableExecutable)) {
    if (Test-Path $output) { Remove-Item -Recurse -Force $output }
}
New-Item -ItemType Directory -Force -Path artifacts | Out-Null

# Builds the frontend, the Rust release binary, and the NSIS setup.exe.
& $TauriCli build --bundles nsis
if ($LASTEXITCODE -ne 0) { throw "Tauri build failed with exit code $LASTEXITCODE" }

$setups = @(Get-ChildItem -Path $NsisDirectory -Filter "*-setup.exe" -File -ErrorAction SilentlyContinue)
if ($setups.Count -ne 1) { throw "Expected exactly one NSIS setup.exe from this build" }
if (-not (Test-Path -PathType Leaf $PortableExecutable)) { throw "This build did not produce the portable executable" }
Copy-Item $setups[0].FullName "artifacts/$AppName-$Version-setup.exe"

# Portable: the release exe plus the application licence and third-party notices. Tauri embeds the
# frontend into the binary; WebView2 is a system runtime present on Windows
# 10/11. The exe is named after the Cargo crate (quickdeck), not the productName.
Compress-Archive -Path "src-tauri/target/release/quickdeck.exe", "LICENSE", "THIRD_PARTY_NOTICES" -DestinationPath "artifacts/$AppName-$Version-win.zip" -Force

Get-ChildItem artifacts
