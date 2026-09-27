<#
  VONO Protection — remove the watchdog Scheduled Task and clean up local state (idempotent).

  Stops + unregisters "VONO Protection", and (optionally) removes the local lock so a later reinstall
  starts clean. Never touches VONO itself or playback. Does NOT delete logs/cache unless -Purge.

  Usage:
    powershell -ExecutionPolicy Bypass -File vono-protection.uninstall.ps1 [-Purge]
#>
[CmdletBinding()]
param(
  [switch] $Purge  # also delete C:\ProgramData\VONO\state\watchdog.lock (and cache)
)
$ErrorActionPreference = "Stop"
$TaskName = "VONO Protection"

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($existing) {
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch {}
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Output "[VONO Protection] unregistered task '$TaskName'"
} else {
  Write-Output "[VONO Protection] task '$TaskName' not present — nothing to unregister"
}

# Release a stale lock so a reinstall can acquire cleanly (the watchdog also self-reclaims dead locks).
$lock = Join-Path $env:ProgramData "VONO\state\watchdog.lock"
if (Test-Path -LiteralPath $lock) { Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue; Write-Output "  removed $lock" }

if ($Purge) {
  $cache = Join-Path $env:ProgramData "VONO\state\watchdog-cache.json"
  if (Test-Path -LiteralPath $cache) { Remove-Item -LiteralPath $cache -Force -ErrorAction SilentlyContinue; Write-Output "  removed $cache" }
}
Write-Output "[VONO Protection] uninstall complete (VONO/playback untouched)."
