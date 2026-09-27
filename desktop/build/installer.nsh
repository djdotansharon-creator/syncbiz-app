; VONO installer provisioning hooks (electron-builder NSIS custom macros).
; The .exe installer itself provisions "VONO Protection" — no PowerShell/Scheduled-Task/autostart steps
; for the branch. All PowerShell here runs HIDDEN via nsExec (no console shown during install/uninstall).

!macro customInstall
  DetailPrint "Provisioning VONO Protection (auto-start watchdog)..."
  ; provision-vono-protection.ps1 registers the hidden, idempotent "VONO Protection" Scheduled Task for
  ; the current station user and removes the legacy VONO Run entry. $INSTDIR is quoted (spaces-safe).
  nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$INSTDIR\vono-watchdog\provision-vono-protection.ps1" -Action install -InstallDir "$INSTDIR"'
  Pop $0
  DetailPrint "VONO Protection provisioning exit code: $0"
!macroend

!macro customUnInstall
  DetailPrint "Removing VONO Protection..."
  ; Inline task teardown so it does not depend on the (about-to-be-removed) install files. /End stops the
  ; running task tree (hidden powershell + watchdog); /Delete removes the single task.
  nsExec::Exec 'schtasks /End /TN "VONO Protection"'
  Pop $0
  nsExec::Exec 'schtasks /Delete /TN "VONO Protection" /F'
  Pop $0
  ; Remove the stale single-watchdog lock so a later reinstall starts clean. Never touches unrelated procs.
  ExpandEnvStrings $1 "%ProgramData%"
  Delete "$1\VONO\state\watchdog.lock"
!macroend
