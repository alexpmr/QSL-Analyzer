param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
$m = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$folder = Split-Path -Parent $Manifest
$log = Join-Path $folder 'update-result.json'
$new = $null
$backup = $null
$stateBackup = Join-Path $folder 'state-before-update.json'
function Get-Sha256([string]$File) {
  # Use the built-in .NET API even when PowerShell inherits a different module search path.
  $stream = [System.IO.File]::OpenRead($File)
  $algorithm = [System.Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-','').ToLowerInvariant() }
  finally { $algorithm.Dispose(); $stream.Dispose() }
}
try {
  if ($m.Mode -notin @('portable','installed') -or $m.ExpectedVersion -notmatch '^\d+\.\d+\.\d+$') { throw 'Invalid update manifest' }
  foreach ($processId in @($m.AppPid,$m.LauncherPid)) {
    if ($processId -gt 0) {
      Wait-Process -Id $processId -Timeout 120 -ErrorAction SilentlyContinue
      if (Get-Process -Id $processId -ErrorAction SilentlyContinue) { throw 'Previous application is still running' }
    }
  }
  if ((Get-Sha256 $m.Candidate) -ne $m.Sha256) { throw 'Update checksum mismatch' }
  if ($m.Mode -eq 'installed') {
    $arguments = '/S --updated --force-run /D=' + $m.InstallDir
    $env:QSL_UPDATE_CONFIRM_FILE = $m.ReadyFile
    # Wait for the installer itself; Start-Process -Wait also waits for the relaunched application.
    $installer = Start-Process -FilePath $m.Candidate -ArgumentList $arguments -PassThru
    if (-not $installer.WaitForExit(120000)) { throw 'Installer did not finish within two minutes' }
    if ($installer.ExitCode -ne 0) { throw 'Installer failed' }
  } else {
    if ((Split-Path -Parent $m.Target) -ne (Split-Path -Parent $m.Original)) { throw 'Update must stay in the portable folder' }
    if (Test-Path -LiteralPath $m.StateFile) { Copy-Item -LiteralPath $m.StateFile -Destination $stateBackup -Force }
    if (Test-Path -LiteralPath $m.Target) {
      if ((Get-Sha256 $m.Target) -ne $m.Sha256) { throw 'Target file has different contents; preserve it' }
    } else { Copy-Item -LiteralPath $m.Candidate -Destination $m.Target }
    $backup = $m.Original + '.previous'
    if (Test-Path -LiteralPath $backup) { Remove-Item -LiteralPath $backup -Force }
    Move-Item -LiteralPath $m.Original -Destination $backup
    $env:QSL_UPDATE_CONFIRM_FILE = $m.ReadyFile
    if ($m.Smoke) { $new = Start-Process -FilePath $m.Target -ArgumentList '--smoke-test' -PassThru } else { $new = Start-Process -FilePath $m.Target -PassThru }
  }
    $deadline = (Get-Date).AddSeconds(90)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
      if (Test-Path -LiteralPath $m.ReadyFile) {
        $confirmation = Get-Content -LiteralPath $m.ReadyFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($confirmation.version -eq $m.ExpectedVersion) { $ready = $true; break }
      }
      if ($new) { $new.Refresh(); if ($new.HasExited) { break } }
      Start-Sleep -Milliseconds 250
    }
    if (-not $ready) { throw 'New version did not confirm startup' }
  @{status='ok';version=$m.ExpectedVersion} | ConvertTo-Json | Set-Content -LiteralPath $log -Encoding UTF8
  Remove-Item -LiteralPath $stateBackup -Force -ErrorAction SilentlyContinue
} catch {
  if ($m.Mode -eq 'portable' -and $backup -and (Test-Path -LiteralPath $backup)) {
    if ($new -and (Get-Process -Id $new.Id -ErrorAction SilentlyContinue)) { try { & "$env:SystemRoot\System32\taskkill.exe" /PID $new.Id /T /F 2>$null | Out-Null } catch {} }
    Remove-Item -LiteralPath $m.Target -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $backup -Destination $m.Original -Force
    if (Test-Path -LiteralPath $stateBackup) { Copy-Item -LiteralPath $stateBackup -Destination $m.StateFile -Force }
    Remove-Item Env:QSL_UPDATE_CONFIRM_FILE -ErrorAction SilentlyContinue
    if (-not $m.Smoke) { Start-Process -FilePath $m.Original }
  }
  @{status='error';version=$m.ExpectedVersion;detail=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $log -Encoding UTF8
  exit 1
}
