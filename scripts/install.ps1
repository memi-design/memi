# Mémoire installer for Windows — no Node, no npm, no admin rights.
#
# Usage (PowerShell):
#   irm https://memoire.cv/install.ps1 | iex
#   & ([scriptblock]::Create((iwr -useb https://memoire.cv/install.ps1).Content)) -Version v2.7.9

param(
    [string]$Version = "latest",
    [string]$InstallDir = "$env:USERPROFILE\.memoire",
    [switch]$NoPath
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
$stage = $null
$backup = $null
$committed = $false

try {
    # A terminated upgrade can leave the prior app parked here. Restore it before
    # doing any network work so a later failed download does not strand the CLI.
    if (Test-Path -LiteralPath $InstallDir) {
        $previousApps = @(Get-ChildItem -LiteralPath $InstallDir -Directory -Force -Filter ".app.previous-*")
        if ($previousApps.Count -gt 1) { throw "Multiple interrupted upgrades found in $InstallDir; inspect them before retrying." }
        if ($previousApps.Count -eq 1) {
            $appDir = Join-Path $InstallDir "app"
            if (-not (Test-Path -LiteralPath (Join-Path $appDir "memi.exe") -PathType Leaf)) {
                if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
                Move-Item -LiteralPath $previousApps[0].FullName -Destination $appDir
                Write-Host "Restored previous installation after an interrupted upgrade."
            } else {
                Remove-Item -LiteralPath $previousApps[0].FullName -Recurse -Force
            }
        }
    }
    Write-Host "-> Downloading $archive"
    Invoke-WebRequest -Uri $url -OutFile (Join-Path $tmp $archive) -UseBasicParsing

    $checksumSource = $null
    try {
        Invoke-WebRequest -Uri $sumsUrl -OutFile (Join-Path $tmp "SHA256SUMS.txt") -UseBasicParsing
        $checksumSource = "SHA256SUMS.txt"
    } catch {
        try {
            Invoke-WebRequest -Uri $archiveSumsUrl -OutFile (Join-Path $tmp "SHA256SUMS.txt") -UseBasicParsing
            $checksumSource = "$archive.sha256"
        } catch {
            throw "Checksum metadata unavailable. Tried $sumsUrl and $archiveSumsUrl."
        }
    }
    $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $archive)).Hash.ToLower()
    $expectedLine = Get-Content (Join-Path $tmp "SHA256SUMS.txt") | Where-Object { $_ -match "^[a-fA-F0-9]{64}\s+\*?memi-win-x64\.zip\s*$" } | Select-Object -First 1
    if (-not $expectedLine) { throw "No checksum found for $archive in $checksumSource." }
    $expected = $expectedLine.Trim().Split([char[]]@(' ', "`t"), [StringSplitOptions]::RemoveEmptyEntries)[0].ToLower()
    if ($actual -ne $expected) { throw "SHA256 mismatch: expected $expected, got $actual" }
    Write-Host "✓ sha256 verified ($checksumSource)"

    $archivePath = Join-Path $tmp $archive
    Add-Type -AssemblyName System.IO.Compression
    $stream = [System.IO.File]::OpenRead($archivePath)
    try {
        $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Read, $false)
        try {
            if ($zip.Entries.Count -eq 0) { throw "unsafe archive entry: archive is empty" }
            $totalSize = [long]0
            foreach ($entry in $zip.Entries) {
                $name = $entry.FullName
                $segments = $name.Split('/')
                $kind = ($entry.ExternalAttributes -shr 16) -band 0xF000
                if ($name.StartsWith('/') -or $name.Contains('\') -or $segments[0] -ne "memi-$target" -or
                    ($segments -contains '..') -or ($segments -contains '.') -or $name.Contains(':') -or
                    ($kind -ne 0 -and $kind -ne 0x4000 -and $kind -ne 0x8000) -or
                    (($entry.ExternalAttributes -band 0x400) -ne 0)) {
                    throw "unsafe archive entry: $name"
                }
                $totalSize += $entry.Length
                if ($totalSize -gt 1073741824) { throw "unsafe archive entry: expanded archive exceeds 1 GiB" }
            }
        } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }

    Write-Host "-> Extracting to $InstallDir"
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    $appDir = Join-Path $InstallDir "app"
    $stage = Join-Path $InstallDir ".app.staged-$([guid]::NewGuid().ToString('N'))"
    $backup = Join-Path $InstallDir ".app.previous-$([guid]::NewGuid().ToString('N'))"
    $extractDir = Join-Path $tmp "extracted"
    Expand-Archive -LiteralPath $archivePath -DestinationPath $extractDir
    $extractedApp = Join-Path $extractDir "memi-$target"
    if (-not (Test-Path -LiteralPath (Join-Path $extractedApp "memi.exe") -PathType Leaf)) {
        throw "unsafe archive entry: memi.exe is missing"
    }
    Move-Item -LiteralPath $extractedApp -Destination $stage
    if (Test-Path -LiteralPath $appDir) { Move-Item -LiteralPath $appDir -Destination $backup }
    try {
        Move-Item -LiteralPath $stage -Destination $appDir

        $binDir = Join-Path $InstallDir "bin"
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null

        # Windows doesn't symlink reliably without admin — write a tiny shim .cmd.
        $shim = Join-Path $binDir "memi.cmd"
        if (-not (Test-Path -LiteralPath $shim)) {
            Set-Content -LiteralPath $shim -Encoding Ascii -Value '@echo off', '"%~dp0..\app\memi.exe" %*'
        }

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

        $committed = $true
    } catch {
        if (Test-Path -LiteralPath $appDir) { Remove-Item -LiteralPath $appDir -Recurse -Force }
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $appDir }
        throw
    }

    Write-Host ""
    Write-Host "Installed to: $InstallDir"
}
finally {
    if ($committed -and $backup -and (Test-Path -LiteralPath $backup)) {
        Remove-Item -LiteralPath $backup -Recurse -Force
    }
    if ($stage -and (Test-Path -LiteralPath $stage)) {
        Remove-Item -LiteralPath $stage -Recurse -Force
    }
    Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
