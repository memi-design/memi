$ErrorActionPreference = "Stop"
$installer = Join-Path $PSScriptRoot "../install.ps1"
$sandbox = Join-Path $env:TEMP "memi-installer-test-$([guid]::NewGuid().ToString('N'))"
$installDir = Join-Path $sandbox "installed"
New-Item -ItemType Directory -Path $sandbox | Out-Null
Add-Type -AssemblyName System.IO.Compression

function Assert-True([bool]$condition, [string]$message) {
    if (-not $condition) { throw $message }
}

function New-FixtureArchive([string]$path, [bool]$unsafe = $false) {
    $stream = [System.IO.File]::Create($path)
    try {
        $zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            $entry = $zip.CreateEntry("memi-win-x64/memi.exe")
            $writer = [System.IO.StreamWriter]::new($entry.Open())
            try { $writer.Write("NEW") } finally { $writer.Dispose() }
            if ($unsafe) {
                $entry = $zip.CreateEntry("memi-win-x64/../../outside.txt")
                $writer = [System.IO.StreamWriter]::new($entry.Open())
                try { $writer.Write("unsafe") } finally { $writer.Dispose() }
            }
        } finally { $zip.Dispose() }
    } finally { $stream.Dispose() }
}

$global:fixtureArchive = Join-Path $sandbox "valid.zip"
$global:downloadFailure = $false
$global:failActivation = $false
New-FixtureArchive $global:fixtureArchive

function Invoke-WebRequest {
    param([string]$Uri, [string]$OutFile, [switch]$UseBasicParsing)
    if ($global:downloadFailure) { throw "fixture download failure" }
    if ($Uri.EndsWith("/memi-win-x64.zip")) {
        Copy-Item -LiteralPath $global:fixtureArchive -Destination $OutFile
        return
    }
    if ($Uri.EndsWith("/SHA256SUMS.txt") -or $Uri.EndsWith("/memi-win-x64.zip.sha256")) {
        $hash = (Get-FileHash -Algorithm SHA256 $global:fixtureArchive).Hash.ToLower()
        Set-Content -LiteralPath $OutFile -Value "$hash  memi-win-x64.zip"
        return
    }
    throw "Unexpected URL: $Uri"
}

function Move-Item {
    param([string]$LiteralPath, [string]$Destination)
    if ($global:failActivation -and $LiteralPath -like "*.app.staged-*") {
        throw "fixture activation failure"
    }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
}

try {
    & $installer -InstallDir $installDir -NoPath
    $app = Join-Path $installDir "app/memi.exe"
    $shim = Join-Path $installDir "bin/memi.cmd"
    Assert-True (Test-Path -LiteralPath $app) "Verified install did not create memi.exe"
    Assert-True (Test-Path -LiteralPath $shim) "Verified install did not create the command shim"
    Assert-True ((Get-Content -Raw $app) -eq "NEW") "Installed app differs from verified fixture"

    Set-Content -LiteralPath $app -Value "OLD"
    $global:fixtureArchive = Join-Path $sandbox "unsafe.zip"
    New-FixtureArchive $global:fixtureArchive $true
    $rejected = $false
    try { & $installer -InstallDir $installDir -NoPath } catch { $rejected = $_.Exception.Message -like "*unsafe archive entry*" }
    Assert-True $rejected "Unsafe ZIP was accepted"
    Assert-True ((Get-Content -Raw $app).Trim() -eq "OLD") "Unsafe ZIP changed the current app"

    $global:fixtureArchive = Join-Path $sandbox "valid.zip"
    $global:failActivation = $true
    $failed = $false
    try { & $installer -InstallDir $installDir -NoPath } catch { $failed = $_.Exception.Message -like "*fixture activation failure*" }
    $global:failActivation = $false
    Assert-True $failed "Activation failure fixture did not run"
    Assert-True ((Get-Content -Raw $app).Trim() -eq "OLD") "Activation failure did not restore the previous app"

    $previous = Join-Path $installDir ".app.previous-interrupted"
    Microsoft.PowerShell.Management\Move-Item -LiteralPath (Join-Path $installDir "app") -Destination $previous
    $global:downloadFailure = $true
    try { & $installer -InstallDir $installDir -NoPath } catch { }
    Assert-True ((Get-Content -Raw $app).Trim() -eq "OLD") "Interrupted upgrade was not recovered before download"
    Assert-True (-not (Test-Path -LiteralPath $previous)) "Recovery left a stale backup"
    Write-Host "Windows installer fixtures passed: verified install, unsafe ZIP, rollback, interruption recovery."
} finally {
    Remove-Item -LiteralPath $sandbox -Recurse -Force -ErrorAction SilentlyContinue
}
