Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$scriptExitCode = 0

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

function Stop-Port {
    param([int]$Port)
    $pids = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($portPid in $pids) {
        if ($portPid -and $portPid -ne $PID) {
            Stop-Process -Id $portPid -Force -ErrorAction SilentlyContinue
        }
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoDir = Split-Path -Parent $scriptDir
$cargoManifest = Join-Path $repoDir "src-tauri\Cargo.toml"
$distDir = Join-Path $repoDir "dist"
$targetDir = Join-Path $repoDir "src-tauri\target"

try {
    Set-Utf8Console
    Require-Command node
    Require-Command npm
    Require-Command cargo
    Require-Command rustc

    Set-Location $repoDir

    Write-Step "Stopping stale development listeners"
    Stop-Port 1421

    Write-Step "Installing current JavaScript dependencies"
    Invoke-Native -FilePath "npm" -ArgumentList @("install")

    Write-Step "Updating npm packages within declared ranges"
    Invoke-Native -FilePath "npm" -ArgumentList @("update")

    Write-Step "Updating Rust crates within Cargo constraints"
    Invoke-Native -FilePath "cargo" -ArgumentList @("update", "--manifest-path", $cargoManifest)

    Write-Step "Cleaning previous build outputs"
    if (Test-Path $distDir) {
        Remove-Item -Recurse -Force $distDir
    }
    if (Test-Path $targetDir) {
        Remove-Item -Recurse -Force $targetDir
    }

    Write-Step "Building the desktop app"
    Invoke-Native -FilePath "npm" -ArgumentList @("run", "tauri", "build")
}
catch {
    Write-Host ""
    Write-Host "quickdeck update-packages failed: $($_.Exception.Message)" -ForegroundColor Red
    $scriptExitCode = 1
}
finally {
    Read-Host "Press Enter to close" | Out-Null
}

exit $scriptExitCode
