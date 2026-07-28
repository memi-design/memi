# Mémoire installer for Windows — no Node, no npm, no admin rights.
#
# Usage (PowerShell):
#   irm https://memoire.cv/install.ps1 | iex
#   & { iwr -useb https://memoire.cv/install.ps1 } -Version v1.2.3

param(
    [string]$Version = "latest",
    [string]$InstallDir = "$env:USERPROFILE\.memoire",
    [switch]$NoPath,
    [switch]$NoVerify
)

$ErrorActionPreference = "Stop"

$repo = "memi-design/memi"
$target = "win-x64"
$archive = "memi-$target.zip"

if ($Version -eq "latest") {
    $base = "https://github.com/$repo/releases/latest/download"
} else {
    $base = "https://github.com/$repo/releases/download/$Version"
}
$url = "$base/$archive"
$sumsUrl = "$base/SHA256SUMS.txt"
$archiveSumsUrl = "$base/$archive.sha256"

$tmp = Join-Path $env:TEMP "memoire-install-$(Get-Random)"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null

try {
    Write-Host "-> Downloading $archive"
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $archive) -UseBasicParsing

    if (-not $NoVerify) {
        $checksumSource = $null
        try {
            Invoke-WebRequest -Uri $sumsUrl -OutFile (Join-Path $tmp "SHA256SUMS.txt") -UseBasicParsing
            $checksumSource = "SHA256SUMS.txt"
        } catch {
            try {
                Invoke-WebRequest -Uri $archiveSumsUrl -OutFile (Join-Path $tmp "SHA256SUMS.txt") -UseBasicParsing
                $checksumSource = "$archive.sha256"
            } catch {
                throw "Checksum metadata unavailable. Tried $sumsUrl and $archiveSumsUrl. Re-run with -NoVerify only if you trust the release source."
            }
        }

        $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $archive)).Hash.ToLower()
        $expectedLine = Get-Content (Join-Path $tmp "SHA256SUMS.txt") | Where-Object { $_ -like "*$archive" } | Select-Object -First 1
        if (-not $expectedLine) {
            throw "No checksum found for $archive in $checksumSource. Re-run with -NoVerify only if you trust the release source."
        }
        $expected = $expectedLine.Split()[0]
        if ($actual -ne $expected) {
            throw "SHA256 mismatch: expected $expected, got $actual"
        }
        Write-Host "✓ sha256 verified ($checksumSource)"
    }

    Write-Host "-> Extracting to $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $appDir = Join-Path $InstallDir "app"
    if (Test-Path $appDir) { Remove-Item -Recurse -Force $appDir }

    Expand-Archive -Path (Join-Path $tmp $archive) -DestinationPath $tmp -Force
    Move-Item (Join-Path $tmp "memi-$target") $appDir

    $binDir = Join-Path $InstallDir "bin"
    New-Item -ItemType Directory -Force -Path $binDir | Out-Null

    # Windows doesn't symlink reliably without admin — write a tiny shim .cmd.
    $shim = Join-Path $binDir "memi.cmd"
    Set-Content -Path $shim -Value "@echo off`r`n`"$appDir\memi.exe`" %*"

    if (-not $NoPath) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        if ($userPath -notlike "*$binDir*") {
            $newPath = if ([string]::IsNullOrEmpty($userPath)) { $binDir } else { "$userPath;$binDir" }
            [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
            Write-Host ""
            Write-Host "Added $binDir to your user PATH."
            Write-Host "Open a new terminal, then run:  memi connect"
        } else {
            Write-Host ""
            Write-Host "memi is ready. Run:  memi connect"
        }
    } else {
        Write-Host ""
        Write-Host "Add to PATH manually:  $binDir"
    }

    Write-Host ""
    Write-Host "Installed to: $InstallDir"
}
finally {
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $tmp
}
