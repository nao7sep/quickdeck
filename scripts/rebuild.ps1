Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptExitCode = 0

# rebuild: produce a fresh PRODUCTION build (Tauri debug binary, --no-bundle) and
# launch it. Slow — run this after changing source. The build runs the frontend's
# production type check and bundle (via beforeBuildCommand) and compiles the Rust
# binary, so type, import, CSP, and packaged-layout errors that run-dev hides
# surface here. run-built is the fast, no-build launcher for everything after
# this.

function Set-Utf8Console {
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [Console]::InputEncoding = $utf8NoBom
    [Console]::OutputEncoding = $utf8NoBom
    $global:OutputEncoding = $utf8NoBom
    if (Get-Command chcp.com -ErrorAction SilentlyContinue) {
        & chcp.com 65001 > $null
        $null = $LASTEXITCODE
    }
}

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
    param([string]$Name)
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "Missing required command: $Name"
    }
}

function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$FilePath,
        [string[]]$ArgumentList = @(),
        [int[]]$AllowedExitCodes = @(0)
    )

    & $FilePath @ArgumentList
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    if ($AllowedExitCodes -notcontains $exitCode) {
        throw "Command failed with exit code ${exitCode}: $FilePath $($ArgumentList -join ' ')"
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $scriptDir

try {
    Set-Utf8Console
    Require-Command node
    Require-Command npm
    Require-Command cargo
    Require-Command rustc

    Set-Location $repoDir

    Write-Step "Installing dependencies"
    Invoke-Native -FilePath "npm" -ArgumentList @("install")

    # Remove stale frontend output so a build that fails to emit a file can't be
    # masked by a leftover artifact from a previous run. Only the frontend output
    # is cleaned: cargo is incremental, and cleaning src-tauri/target would force
    # a multi-minute recompile of the Rust binary.
    Write-Step "Cleaning previous frontend build"
    if (Test-Path "dist") { Remove-Item -Recurse -Force "dist" }

    # tauri build --debug triggers beforeBuildCommand (the frontend `tsc && vite
    # build`) and then compiles the Rust debug binary; --no-bundle skips the
    # dmg/nsis packaging we don't want here.
    Write-Step "Building production frontend and debug binary"
    Invoke-Native -FilePath "node_modules/.bin/tauri.cmd" -ArgumentList @("build", "--debug", "--no-bundle")

    # Launching the built binary directly loads the production frontend with the
    # tauri.conf CSP, which tauri dev does not.
    Write-Step "Launching the built binary"
    Invoke-Native -FilePath "src-tauri\target\debug\quickdeck.exe" -AllowedExitCodes @(0, 130, -1073741510)
}
catch {
    Write-Host ""
    Write-Host "quickdeck rebuild failed: $($_.Exception.Message)" -ForegroundColor Red
    $scriptExitCode = 1
}
finally {
    Read-Host "Press Enter to close" | Out-Null
}

exit $scriptExitCode
