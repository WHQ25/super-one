# Install the SuperOne-managed Claude binary into the layout the desktop app
# already knows how to resolve:
#
#   %USERPROFILE%\.superone\harness\claude\versions\<pin>\
#     lib\node_modules\@anthropic-ai\claude-agent-sdk-win32-<arch>\claude.exe
#   %USERPROFILE%\.superone\harness\claude\current
#
# Use this when a packaged upgrade whitescreens because the first-launch
# download has not finished (or failed). After the script succeeds, fully quit
# SuperOne and relaunch — the in-process miss cache only clears on restart.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\install-claude-harness.ps1
#   powershell -ExecutionPolicy Bypass -File .\install-claude-harness.ps1 --version 0.3.232 --force
#   $env:SUPERONE_HARNESS_HOME = 'D:\harness'; powershell -ExecutionPolicy Bypass -File .\install-claude-harness.ps1
#
# Windows only. macOS / Linux: scripts/install-claude-harness.sh

$ErrorActionPreference = 'Stop'
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
  # Older hosts may already have TLS 1.2 as the default.
}

$DefaultVersion = '0.3.232'
$CdnBase = 'https://dl.super-one.dev'
$NpmRegistry = 'https://registry.npmjs.org'

function Show-Usage {
  @"
Usage: $(Split-Path -Leaf $PSCommandPath) [options]

Download the Claude Agent SDK native binary SuperOne expects and install it
under %USERPROFILE%\.superone\harness (or SUPERONE_HARNESS_HOME).

Options:
  --version VER   Runtime pin (default: $DefaultVersion, or SUPERONE_CLAUDE_SDK_VERSION)
  --home DIR      Harness root (default: `$env:SUPERONE_HARNESS_HOME or %USERPROFILE%\.superone\harness)
  --force         Re-download even if the binary is already present
  -h, --help      Show this help

After it finishes, fully quit SuperOne (not just close the window) and open it again.
"@
}

$Version = if ($env:SUPERONE_CLAUDE_SDK_VERSION) { $env:SUPERONE_CLAUDE_SDK_VERSION } else { $DefaultVersion }
$HarnessHome = $env:SUPERONE_HARNESS_HOME
$Force = $false

for ($i = 0; $i -lt $args.Count; $i++) {
  switch ($args[$i]) {
    '--version' {
      if ($i + 1 -ge $args.Count) { throw '--version requires a value' }
      $Version = $args[++$i]
    }
    '--home' {
      if ($i + 1 -ge $args.Count) { throw '--home requires a value' }
      $HarnessHome = $args[++$i]
    }
    '--force' { $Force = $true }
    { $_ -in @('-h', '--help', '-?') } {
      Show-Usage
      exit 0
    }
    default {
      Write-Host "error: unknown argument: $($args[$i])" -ForegroundColor Red
      Show-Usage
      exit 2
    }
  }
}

if ([string]::IsNullOrWhiteSpace($Version) -or $Version -match '\.\.|[/\\]') {
  Write-Host "error: invalid --version: $Version" -ForegroundColor Red
  exit 2
}

if ([string]::IsNullOrWhiteSpace($HarnessHome)) {
  $HarnessHome = Join-Path $env:USERPROFILE '.superone\harness'
}

function Get-ClaudePackageName {
  if ($env:OS -notmatch 'Windows') {
    throw 'this script is Windows only; use scripts/install-claude-harness.sh'
  }
  $arch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
  switch ($arch) {
    'X64' { return '@anthropic-ai/claude-agent-sdk-win32-x64' }
    'Arm64' { return '@anthropic-ai/claude-agent-sdk-win32-arm64' }
    default {
      # PowerShell 5.1 on older runtimes: fall back to PROCESSOR_ARCHITECTURE.
      switch ($env:PROCESSOR_ARCHITECTURE) {
        'AMD64' { return '@anthropic-ai/claude-agent-sdk-win32-x64' }
        'ARM64' { return '@anthropic-ai/claude-agent-sdk-win32-arm64' }
        default { throw "unsupported arch: $arch / $($env:PROCESSOR_ARCHITECTURE)" }
      }
    }
  }
}

function Get-UnixTimeMs {
  [int64](([DateTime]::UtcNow - [DateTime]'1970-01-01Z').TotalMilliseconds)
}

function Write-JsonFile {
  param(
    [ValidateSet('meta', 'current')]
    [string]$Kind,
    [string]$Dest,
    [string]$RuntimeVersion,
    [string]$InstallRoot,
    [string]$PackageSpec
  )
  $now = Get-UnixTimeMs
  if ($Kind -eq 'current') {
    $payload = [ordered]@{
      runtimeVersion = $RuntimeVersion
      installRoot    = $InstallRoot
      updatedAt      = $now
    }
  } else {
    $payload = [ordered]@{
      harnessId      = 'claude'
      runtimeVersion = $RuntimeVersion
      packageSpec    = $PackageSpec
      source         = 'manual-script'
      installedAt    = $now
      updatedAt      = $now
    }
  }
  $json = ($payload | ConvertTo-Json -Compress:$false) + "`n"
  $dir = Split-Path -Parent $Dest
  if ($dir -and -not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  [System.IO.File]::WriteAllText($Dest, $json)
}

function Get-RemoteFile {
  param(
    [string]$Url,
    [string]$Dest,
    [int]$TimeoutSec = 0
  )
  $params = @{
    Uri             = $Url
    OutFile         = $Dest
    UseBasicParsing = $true
  }
  if ($TimeoutSec -gt 0) { $params.TimeoutSec = $TimeoutSec }
  Invoke-WebRequest @params
}

function Install-CurrentPointer {
  param(
    [string]$Prefix,
    [string]$RuntimeVersion,
    [string]$InstallRoot,
    [string]$PackageSpec
  )
  if (-not (Test-Path -LiteralPath $Prefix)) {
    New-Item -ItemType Directory -Path $Prefix -Force | Out-Null
  }
  $tmp = Join-Path $Prefix ('.current.{0}.{1}.tmp' -f $PID, (Get-Random))
  Write-JsonFile -Kind current -Dest $tmp -RuntimeVersion $RuntimeVersion -InstallRoot $InstallRoot -PackageSpec $PackageSpec
  $dest = Join-Path $Prefix 'current'
  Move-Item -LiteralPath $tmp -Destination $dest -Force
}

$NpmName = Get-ClaudePackageName
$BinName = 'claude.exe'
$Prefix = Join-Path $HarnessHome 'claude'
$VersionDir = Join-Path $Prefix "versions\$Version"
$PkgDir = Join-Path $VersionDir "lib\node_modules\$($NpmName -replace '/', '\')"
$BinPath = Join-Path $PkgDir $BinName
$ArtifactDir = ($NpmName.TrimStart('@') -replace '/', '--')
$CdnUrl = "$CdnBase/harness/artifacts/$ArtifactDir/$Version.tgz"
$NpmUrl = "$NpmRegistry/$NpmName/-/$($NpmName.Split('/')[-1])-$Version.tgz"
$PackageSpec = "$NpmName@$Version"

Write-Host 'SuperOne Claude harness install'
Write-Host "  pin:     $Version"
Write-Host "  package: $NpmName"
Write-Host "  home:    $HarnessHome"

if (-not $Force -and (Test-Path -LiteralPath $BinPath)) {
  Write-Host "Binary already present: $BinPath"
  Write-JsonFile -Kind meta -Dest (Join-Path $VersionDir 'install-meta.json') -RuntimeVersion $Version -InstallRoot $VersionDir -PackageSpec $PackageSpec
  Install-CurrentPointer -Prefix $Prefix -RuntimeVersion $Version -InstallRoot $VersionDir -PackageSpec $PackageSpec
  Write-Host "Pointer updated: $(Join-Path $Prefix 'current')"
  Write-Host ''
  Write-Host 'Fully quit SuperOne and relaunch.'
  exit 0
}

$tar = Get-Command tar.exe -ErrorAction SilentlyContinue
if (-not $tar) {
  throw 'tar.exe is required (Windows 10 1803+). Install the latest Windows or extract the .tgz yourself.'
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("superone-claude-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work -Force | Out-Null
try {
  $tgz = Join-Path $work 'pkg.tgz'
  Write-Host "Downloading $CdnUrl"
  try {
    Get-RemoteFile -Url $CdnUrl -Dest $tgz -TimeoutSec 25
  } catch {
    Write-Host "CDN failed, falling back to npm: $NpmUrl"
    Get-RemoteFile -Url $NpmUrl -Dest $tgz
  }

  $extract = Join-Path $work 'out'
  New-Item -ItemType Directory -Path $extract -Force | Out-Null
  & tar.exe -xzf $tgz -C $extract
  if ($LASTEXITCODE -ne 0) { throw "tar extract failed with exit $LASTEXITCODE" }

  $packageDir = Join-Path $extract 'package'
  $extractedBin = Join-Path $packageDir $BinName
  if (-not (Test-Path -LiteralPath $packageDir)) {
    throw 'tarball has no package/ directory'
  }
  if (-not (Test-Path -LiteralPath $extractedBin)) {
    throw "tarball is missing $BinName"
  }

  $pkgParent = Split-Path -Parent $PkgDir
  if (-not (Test-Path -LiteralPath $pkgParent)) {
    New-Item -ItemType Directory -Path $pkgParent -Force | Out-Null
  }
  if (Test-Path -LiteralPath $PkgDir) {
    Remove-Item -LiteralPath $PkgDir -Recurse -Force
  }
  if (-not (Test-Path -LiteralPath $VersionDir)) {
    New-Item -ItemType Directory -Path $VersionDir -Force | Out-Null
  }
  Move-Item -LiteralPath $packageDir -Destination $PkgDir

  if (-not (Test-Path -LiteralPath $BinPath)) {
    throw "installed binary is missing: $BinPath"
  }

  Write-JsonFile -Kind meta -Dest (Join-Path $VersionDir 'install-meta.json') -RuntimeVersion $Version -InstallRoot $VersionDir -PackageSpec $PackageSpec
  Install-CurrentPointer -Prefix $Prefix -RuntimeVersion $Version -InstallRoot $VersionDir -PackageSpec $PackageSpec

  Write-Host "Installed: $BinPath"
  Write-Host "Pointer:   $(Join-Path $Prefix 'current') -> $Version"
  Write-Host ''
  Write-Host 'Fully quit SuperOne and open it again.'
  Write-Host 'The running process caches a missing binary and will not pick this up until restart.'
} finally {
  if (Test-Path -LiteralPath $work) {
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
  }
}
