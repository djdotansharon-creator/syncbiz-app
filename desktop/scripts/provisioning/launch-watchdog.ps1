<#
  VONO Protection — hidden watchdog launcher (the Scheduled Task action runs this via
  `powershell.exe -WindowStyle Hidden -File launch-watchdog.ps1`).

  Runs the bundled node.exe + watchdog.cjs in the FOREGROUND (this script blocks) so:
   - the Scheduled Task stays in the Running state, and
   - restart-on-failure applies if the watchdog ever exits non-zero.
  Because the parent powershell is launched with -WindowStyle Hidden, node inherits its hidden console:
  NO visible console window. $PSScriptRoot resolves the install's vono-watchdog dir, so paths with
  spaces (e.g. C:\Users\YCD ATMOSPHERE\...) are handled without any string interpolation.
#>
$ErrorActionPreference = "Stop"
$node = Join-Path $PSScriptRoot "node.exe"
$cjs  = Join-Path $PSScriptRoot "watchdog.cjs"
& $node $cjs
exit $LASTEXITCODE
