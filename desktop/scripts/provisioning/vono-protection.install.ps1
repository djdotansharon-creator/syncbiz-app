<#
  VONO Protection — install the watchdog Scheduled Task (idempotent).

  Registers task "VONO Protection" from vono-protection.task.xml, substituting the station user and
  install dir. Runs as the station user, interactive, NON-elevated (InteractiveToken/LeastPrivilege).
  Does NOT create the task elevated; this script itself may need admin only to register a task for the
  user — run it during provisioning.

  Usage:
    powershell -ExecutionPolicy Bypass -File vono-protection.install.ps1 `
      -StationUser "DESKTOP-XXXX\vono-station" `
      -InstallDir  "C:\Users\vono-station\AppData\Local\Programs\SyncBiz Player"

  Preconditions (verified, not created, here):
    - <InstallDir>\vono-watchdog\node.exe and watchdog.cjs exist.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)] [string] $StationUser,
  [Parameter(Mandatory = $true)] [string] $InstallDir
)
$ErrorActionPreference = "Stop"
$TaskName = "VONO Protection"

$nodeExe = Join-Path $InstallDir "vono-watchdog\node.exe"
$watchCjs = Join-Path $InstallDir "vono-watchdog\watchdog.cjs"
if (-not (Test-Path -LiteralPath $nodeExe))  { throw "Missing runtime: $nodeExe" }
if (-not (Test-Path -LiteralPath $watchCjs)) { throw "Missing watchdog: $watchCjs" }

$tpl = Join-Path $PSScriptRoot "vono-protection.task.xml"
if (-not (Test-Path -LiteralPath $tpl)) { throw "Missing task template: $tpl" }

$xml = Get-Content -LiteralPath $tpl -Raw
$xml = $xml.Replace("{{STATION_USER}}", $StationUser).Replace("{{INSTALL_DIR}}", $InstallDir)

# Register (idempotent: -Force replaces an existing task of the same name).
Register-ScheduledTask -TaskName $TaskName -Xml $xml -User $StationUser -Force | Out-Null
Write-Output "[VONO Protection] installed task '$TaskName' for $StationUser"
Write-Output "  program: $nodeExe"
Write-Output "  args:    `"$watchCjs`""
Write-Output "  Start it now (or it runs at the next logon) with:"
Write-Output "    Start-ScheduledTask -TaskName '$TaskName'"
