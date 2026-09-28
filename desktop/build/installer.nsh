; VONO installer provisioning hooks (electron-builder NSIS custom macros).
; The .exe installer itself provisions "VONO Protection" — no PowerShell/Scheduled-Task/autostart steps
; for the branch. All PowerShell here runs HIDDEN via nsExec (no console shown during install/uninstall).

; ── ZERO-TOUCH UPGRADE: stop the OLD install BEFORE electron-builder replaces files ────────────────
; `customCheckAppRunning` REPLACES the built-in app-running check (allowOnlyOneInstallerInstance.nsh) and
; runs in the install Section AFTER InitPluginsDir but BEFORE uninstallOldVersion / installApplicationFiles.
; The built-in only taskkills the app — it never stops VONO Protection first, so the still-running watchdog
; relaunches VONO mid-update and the running app locks the files. We run an identity-safe teardown instead:
; stop+disable the task, kill the watchdog, close VONO + its MPV (all scoped to $INSTDIR), then let the
; installer replace files. The script is embedded in the installer and extracted to $PLUGINSDIR, so it does
; NOT depend on the (old) installed copy — this works for the first upgrade over a build that lacks it.
!macro customCheckAppRunning
  DetailPrint "Preparing update (stopping VONO Protection + closing the player)..."
  File "/oname=$PLUGINSDIR\stop-vono-for-upgrade.ps1" "${PROJECT_DIR}\scripts\provisioning\stop-vono-for-upgrade.ps1"
  nsExec::Exec 'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-vono-for-upgrade.ps1" -InstallDir "$INSTDIR"'
  Pop $0
  DetailPrint "Update pre-flight exit code: $0"
!macroend

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
