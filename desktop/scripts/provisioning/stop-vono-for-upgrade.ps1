<#
  VONO upgrade pre-flight teardown — invoked HIDDEN by the NSIS installer's `customCheckAppRunning` hook
  BEFORE electron-builder replaces the app files. Without it, the built-in check kills VONO but the still
  -running "VONO Protection" watchdog relaunches it, so the running app locks the files being replaced.

  Ordered, identity-safe, fail-safe:
   1. Stop + DISABLE the "VONO Protection" task so the watchdog cannot relaunch VONO during the update.
   2. Kill the watchdog (node.exe from THIS install + the powershell launcher for THIS install) FIRST.
   3. Close VONO gracefully (bounded), then force — scoped to THIS install's exe path.
   4. Ensure VONO-owned MPV from THIS install is gone.
   5. Bounded confirm that the exe/mpv are released.

  Identity safety: every kill matches an exact ExecutablePath under -InstallDir (or the launcher's command
  line referencing THIS install), so unrelated mpv.exe / node.exe / powershell.exe / Electron apps are
  NEVER touched. Fail-safe: $ErrorActionPreference=SilentlyContinue and try/catch everywhere — it must
  NEVER throw (that would abort the installer). Path-safe: absolute paths via Join-Path (spaces OK).

  Maintenance shutdown only: it does NOT touch the recovery snapshot / shuffle / playlist (those live in
  Electron userData, OUTSIDE -InstallDir), so the freshly-installed VONO auto-resumes what was playing.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$InstallDir)
$ErrorActionPreference = "SilentlyContinue"
$TaskName = "VONO Protection"

$wd      = Join-Path $InstallDir "vono-watchdog"
$nodeExe = Join-Path $wd "node.exe"
$runner  = Join-Path $wd "launch-watchdog.ps1"
$appExe  = Join-Path $InstallDir "SyncBiz Player.exe"
$mpvExe  = Join-Path $InstallDir "resources\mpv.exe"

function Log([string]$m) { Write-Output "[stop-vono-for-upgrade] $m" }

# 1) Stop + DISABLE the Scheduled Task (so the watchdog cannot relaunch VONO mid-update).
try { & schtasks /End /TN $TaskName 2>$null | Out-Null } catch {}
try { & schtasks /Change /TN $TaskName /DISABLE 2>$null | Out-Null } catch {}
Log "Protection task stopped + disabled (if present)."

# Identity-safe selection: processes whose EXACT ExecutablePath equals $exePath (under $InstallDir).
function Get-ByPath([string]$exePath) {
  if (-not $exePath) { return @() }
  $leaf = Split-Path $exePath -Leaf
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name='$($leaf.Replace("'","''"))'" -ErrorAction SilentlyContinue |
      Where-Object { $_.ExecutablePath -and ($_.ExecutablePath -ieq $exePath) })
  } catch { return @() }
}

function Stop-Procs($procs, [int]$graceMs, [string]$label) {
  $list = @($procs | Where-Object { $_ })
  if ($list.Count -eq 0) { return }
  if ($graceMs -gt 0) {
    foreach ($p in $list) {
      try { $h = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue; if ($h) { [void]$h.CloseMainWindow() } } catch {}
    }
    $deadline = (Get-Date).AddMilliseconds($graceMs)
    while ((Get-Date) -lt $deadline) {
      $alive = $false
      foreach ($p in $list) { if (Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue) { $alive = $true; break } }
      if (-not $alive) { break }
      Start-Sleep -Milliseconds 150
    }
  }
  foreach ($p in $list) { try { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } catch {} }
  Log "Stopped $($list.Count) $label process(es)."
}

# 2) Kill the WATCHDOG first: node.exe from THIS install + the powershell launcher for THIS install.
Stop-Procs (Get-ByPath $nodeExe) 0 "watchdog-node"
try {
  $runnerLc = $runner.ToLower()
  $psRunners = @(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains($runnerLc) })
  Stop-Procs $psRunners 0 "watchdog-launcher"
} catch {}

# Identity-safe MPV selection: mpv.exe that is EITHER this install's bundled exe path OR was spawned by
# this install's VONO (ParentProcessId in $parentPids). Covers a cache-resolved mpv (a newer GitHub copy
# lives outside $InstallDir) while never touching an unrelated mpv.exe. $parentPids is captured BEFORE
# VONO is killed; a child's ParentProcessId is retained even after the parent exits.
function Get-VonoMpv([int[]]$parentPids) {
  try {
    return @(Get-CimInstance Win32_Process -Filter "Name='mpv.exe'" -ErrorAction SilentlyContinue |
      Where-Object {
        ($_.ExecutablePath -and ($_.ExecutablePath -ieq $mpvExe)) -or
        ($parentPids -and ($parentPids -contains [int]$_.ParentProcessId))
      })
  } catch { return @() }
}

# 3) Close VONO gracefully (bounded), then force — only this install's exe path. Capture pids first so
#    VONO-owned MPV (even a cache-resolved copy) can be matched by parent after VONO exits.
$vonoProcs = Get-ByPath $appExe
$vonoPids  = @($vonoProcs | ForEach-Object { [int]$_.ProcessId })
Stop-Procs $vonoProcs 4000 "VONO"

# 4) Ensure VONO-owned MPV is gone (this install's path OR spawned by the VONO we just stopped).
Stop-Procs (Get-VonoMpv $vonoPids) 0 "MPV"

# 5) Bounded confirm the app/mpv are released (re-kill any late relaunch; watchdog is already dead).
$deadline = (Get-Date).AddSeconds(6)
while ((Get-Date) -lt $deadline) {
  $app = Get-ByPath $appExe
  $mpv = Get-VonoMpv $vonoPids
  if (@($app).Count -eq 0 -and @($mpv).Count -eq 0) { break }
  Stop-Procs $app 0 "VONO(retry)"
  Stop-Procs $mpv 0 "MPV(retry)"
  Start-Sleep -Milliseconds 200
}
Log "Pre-upgrade teardown complete."
exit 0
