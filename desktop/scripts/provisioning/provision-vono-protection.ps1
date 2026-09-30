<#
  VONO Protection - provision/deprovision the "VONO Protection" Scheduled Task. Invoked automatically
  and silently by the NSIS installer (customInstall/customUnInstall). Not a manual branch step.

  Usage (installer runs this hidden):
    powershell -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass `
      -File provision-vono-protection.ps1 -Action install   -InstallDir "<INSTDIR>"
    powershell ... -File provision-vono-protection.ps1 -Action uninstall -InstallDir "<INSTDIR>"

  install (idempotent - replaces any existing task so exactly ONE "VONO Protection" survives):
   - AtLogOn trigger for the CURRENT (station) user; InteractiveToken; LeastPrivilege (non-elevated).
   - Action = hidden powershell running launch-watchdog.ps1 (no visible console; task stays Running).
   - MultipleInstances=IgnoreNew; RestartOnFailure 1 min x3; StartWhenAvailable; no network dependency;
     no execution time limit (PT0S) so the 24/7 watchdog is never auto-killed.
   - Removes ONLY the known legacy VONO autostart Run value (electron.app.SyncBiz Player) - never any
     unrelated/third-party (e.g. YCD) startup entry.
   - Starts the task immediately when possible; otherwise it starts deterministically at next logon.

  uninstall: stop + remove the task and the stale watchdog lock. Never kills unrelated processes.

  Path-safe: absolute paths, cmdlet argument arrays (no shell interpolation). Fails closed on install
  (non-zero exit) so the installer surfaces a provisioning failure.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet("install", "uninstall", "ensure")][string]$Action,
  [Parameter(Mandatory = $true)][string]$InstallDir
)
$ErrorActionPreference = "Stop"
$TaskName = "VONO Protection"

function Install-Task {
  if ($env:VONO_TEST_NO_TASK_OPS -eq '1') { Write-Output "TEST: would install task"; return }  # test seam - no real mutation
  $wd     = Join-Path $InstallDir "vono-watchdog"
  $runner = Join-Path $wd "launch-watchdog.ps1"
  $node   = Join-Path $wd "node.exe"
  $cjs    = Join-Path $wd "watchdog.cjs"
  foreach ($f in @($runner, $node, $cjs)) { if (-not (Test-Path -LiteralPath $f)) { throw "Missing required file: $f" } }

  $psExe = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $user  = "$env:USERDOMAIN\$env:USERNAME"

  # Hidden action: -WindowStyle Hidden => no visible console; -File avoids embedding other spaced paths.
  $arg = "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""
  $action    = New-ScheduledTaskAction -Execute $psExe -Argument $arg -WorkingDirectory $wd
  $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $user
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  $settings  = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable `
                 -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                 -RestartInterval (New-TimeSpan -Minutes 1) -RestartCount 3
  $settings.ExecutionTimeLimit = "PT0S"        # no limit - the watchdog runs 24/7
  $settings.DisallowStartOnRemoteAppSession = $false

  # -Force makes this idempotent: any existing "VONO Protection" is replaced => exactly one task.
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null

  # Remove ONLY the known legacy VONO Run value so the watchdog is the sole launcher. Never touches
  # any other (third-party / YCD) autostart entry.
  Remove-ItemProperty -Path "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -Name "electron.app.SyncBiz Player" -ErrorAction SilentlyContinue

  # Start now when possible; else the AtLogOn trigger starts it deterministically at next logon.
  try { Start-ScheduledTask -TaskName $TaskName } catch { Write-Output "start deferred to next logon: $($_.Exception.Message)" }
  Write-Output "[VONO Protection] installed for $user (single task, hidden, restart 1m x3)."
}

function Uninstall-Task {
  if ($env:VONO_TEST_NO_TASK_OPS -eq '1') { Write-Output "TEST: would uninstall task"; return }  # test seam - no real mutation
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
  try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch {}
  $lock = Join-Path $env:ProgramData "VONO\state\watchdog.lock"
  if (Test-Path -LiteralPath $lock) { Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue }
  Write-Output "[VONO Protection] uninstalled (task removed; VONO/playback untouched)."
}

# ensure (Phase B2) - protection.json is the authority. Provision the task ONLY when the persisted preference
# is enabled=true; otherwise leave the task absent. A genuinely NEW install (no protection.json) is Protection
# OFF and gets a deterministic {enabled:false, source:"installer"} record. A malformed/unreadable preference
# FAILS SAFE: it does NOT act on corrupt state (no forced ON/OFF) and returns a non-zero code so the installer
# surfaces it - the operator re-enables from Settings, which rewrites a clean protection.json.
function Ensure-FromState {
  $stateDir = Join-Path $env:ProgramData "VONO\state"
  $protJson = Join-Path $stateDir "protection.json"
  if (-not (Test-Path -LiteralPath $protJson)) {
    try {
      New-Item -ItemType Directory -Force -Path $stateDir | Out-Null
      $obj = [ordered]@{ schemaVersion = 1; enabled = $false; updatedAt = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); source = "installer" }
      $tmp = "$protJson.tmp"
      ($obj | ConvertTo-Json -Compress) | Set-Content -LiteralPath $tmp -Encoding UTF8
      Move-Item -LiteralPath $tmp -Destination $protJson -Force
    } catch {}
    Write-Output "[VONO Protection] new install - Protection OFF (no task provisioned)."
    exit 0
  }
  $raw = $null
  try { $raw = Get-Content -LiteralPath $protJson -Raw -ErrorAction Stop } catch { $raw = $null }
  $parsed = $null
  if ($raw) { try { $parsed = $raw | ConvertFrom-Json } catch { $parsed = $null } }
  $enabled = if ($parsed) { $parsed.enabled } else { $null }
  if ($enabled -isnot [bool]) {
    Write-Output "[VONO Protection] protection.json unreadable/malformed - not provisioning (state unchanged; re-enable from Settings)."
    exit 2
  }
  if ($enabled) { Install-Task; exit 0 }
  Write-Output "[VONO Protection] preference OFF - no task provisioned."
  exit 0
}

switch ($Action) {
  "install"   { Install-Task }
  "uninstall" { Uninstall-Task }
  "ensure"    { Ensure-FromState }
}
