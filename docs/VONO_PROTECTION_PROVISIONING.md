# VONO Protection — Lenovo Provisioning & Scheduled Task (PR-D)

## ⚠️ Tracked follow-ups (NOT blockers for the pilot PR-D)

**FOLLOW-UP 1 — DONE (2026-09-27):** the bundled watchdog runtime is pinned to **Node v22.23.3 LTS
("Jod"), win-x64**, with `PINNED_SHA256 = 9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e`
in `fetch-node-runtime.cjs`. The fetch verifies downloaded == official `SHASUMS256.txt` == pin and fails
closed (no unverified runtime staged). Verified end-to-end: fetch+hash pass, and the staged node.exe
runs the bundle. (Re-pin version + hash on a future Node 22.x bump.)

**FOLLOW-UP 2 — before FLEET SCALE (100→300):** replace the stale-lock **blind-unlink** reclaim in
`watchdog-lock.ts` with an **atomic rename/claim** (`rename(lock → lock.<ownerId>)`; only one contender
wins the rename) so two watchdogs can never both reclaim the same stale lock, and add an **N5 concurrent
stale-reclaim** test. Today the Scheduled Task's `MultipleInstances=IgnoreNew` is the primary
single-instance guard, so this race has low real-world exposure for a task-launched pilot; it is
**required before large-scale rollout**.


How the external VONO Watchdog is packaged, auto-started, and provisioned on a branch station. Design
of record: [`docs/VONO_CORE_PROTECTION.md`](VONO_CORE_PROTECTION.md). **No Fleet / Control Room / AI /
playback changes here.**

## Packaged layout (shipped by the installer)

```
<install>\                              (e.g. %LOCALAPPDATA%\Programs\SyncBiz Player)
  SyncBiz Player.exe                    the VONO/Electron app (unchanged)
  resources\...                         (app resources, mpv.exe, etc.)
  vono-watchdog\                        ← win.extraFiles → app-root sibling
    node.exe                            dedicated pinned Node runtime (NOT the Electron exe)
    watchdog.cjs                        esbuilt single-file watchdog (no external npm deps)
    NODE_LICENSE.txt                    Node's license/notice (shipped alongside the runtime)
    launch-watchdog.ps1                 hidden foreground runner (node.exe watchdog.cjs) — no console
    provision-vono-protection.ps1       registers/removes the "VONO Protection" task (installer runs it)
```

**Zero-touch install:** the `.exe` installer itself provisions everything — **DOWNLOAD → INSTALL → DONE**.
No PowerShell, no Scheduled-Task setup, no autostart edits, no hidden-console fix, no per-branch technician
config. The NSIS `customInstall` hook ([`desktop/build/installer.nsh`](../desktop/build/installer.nsh))
runs `provision-vono-protection.ps1` **silently** (`nsExec` + `-WindowStyle Hidden`); `customUnInstall`
tears the task down.

**Node runtime supply-chain:** pinned **v22.23.3 LTS / win-x64** from the official
`https://nodejs.org/dist/`, `PINNED_SHA256 = 9c9245166b4a8e182e0b797da9c20136117ff24368eaff1fec8343a123c8db0e`.
`fetch-node-runtime.cjs` SHA-256-verifies the downloaded `node.exe` against BOTH the official
`SHASUMS256.txt` entry for `win-x64/node.exe` AND the in-repo `PINNED_SHA256`; the build **fails closed**
on any mismatch (no silent fallback). Ships `NODE_LICENSE.txt`.

Build-time staging (run by `npm run dist:win`):
- `scripts/fetch-node-runtime.cjs` → `resources/vono-watchdog/node.exe` (pinned Node LTS win-x64).
- `scripts/build-watchdog.cjs` (esbuild) → `resources/vono-watchdog/watchdog.cjs`.
- electron-builder `win.extraFiles` copies `resources/vono-watchdog/` → `<install>\vono-watchdog\`.

Runtime state (created by the watchdog, LOCAL only): `C:\ProgramData\VONO\state\` (`heartbeat.json`,
`watchdog-cache.json`, `watchdog.lock`) and `\logs\` (`watchdog.log`, `restart-history.json`).

## Scheduled Task ("VONO Protection")

Registered/removed by [`desktop/scripts/provisioning/provision-vono-protection.ps1`](../desktop/scripts/provisioning/provision-vono-protection.ps1)
(`-Action install|uninstall`), which the installer runs automatically and hidden. It uses the native
`*-ScheduledTask*` cmdlets (no static XML) so the trigger/principal always bind to the **actual current
station user** on the box being installed. Registration is idempotent (`Register-ScheduledTask -Force`) —
exactly one "VONO Protection" survives an upgrade/reinstall.

| Field | Value |
|---|---|
| Trigger | **At log on** of the current station user (`New-ScheduledTaskTrigger -AtLogOn -User $env:USERDOMAIN\$env:USERNAME`) |
| Principal | station user, **Interactive** (InteractiveToken), **Limited** (LeastPrivilege / NON-elevated) |
| Program | `powershell.exe` **hidden** (`-WindowStyle Hidden -File launch-watchdog.ps1`) — **no visible console** |
| Runner | `launch-watchdog.ps1` runs `<install>\vono-watchdog\node.exe watchdog.cjs` in the **foreground** so the task stays *Running* and restart-on-failure applies |
| Working dir | `<install>\vono-watchdog` |
| MultipleInstances | **IgnoreNew** |
| Restart on failure | every **1 min**, max **3** |
| Execution time limit | **PT0S** (no limit — runs 24/7) |
| Start when available | **on** (run ASAP after a missed start) |
| Batteries | `AllowStartIfOnBatteries` / `DontStopIfGoingOnBatteries` |
| Start behavior | started immediately when possible; else deterministically at next logon (AtLogOn) |

**Hidden console:** the earlier direct `node.exe` action showed a console window. The task now launches
`powershell.exe -WindowStyle Hidden` which runs the node watchdog with no window — the Lenovo-validated
hidden-launch method, applied automatically by the installer (no manual task edit per branch).

**Path-safety:** `launch-watchdog.ps1` resolves its siblings via `$PSScriptRoot` and `provision-*.ps1`
uses cmdlet argument arrays / quoted paths — safe for install dirs with spaces (e.g.
`C:\Users\YCD ATMOSPHERE\...`). Install **fails closed** (`$ErrorActionPreference=Stop` + throws if
`node.exe`/`watchdog.cjs`/runner are missing) so a broken package surfaces a provisioning error.

Elevation: NOT used. Same-user launch of the GUI and `taskkill` of same-user processes need no
elevation; `HighestAvailable` can break desktop interaction. (Revisit only with an audited need.)

## Single-watchdog ownership (two layers)
1. Scheduled Task `MultipleInstances=IgnoreNew`.
2. Watchdog **atomic lockfile** `C:\ProgramData\VONO\state\watchdog.lock` — exclusive `open(…, "wx")`
   create (never check-then-create). Stale recovery never trusts the PID alone and never kills:
   dead pid ⇒ reclaim; live pid whose image is our `node.exe` ⇒ exit cleanly; live pid reused by an
   unrelated process ⇒ reclaim the file (the foreign process is never touched).

## VONO launch ownership

**CODE AUDIT (repository — what the app ships):** the only VONO autostart in the codebase is Electron's
login-item (an HKCU `…\Run` key) behind a **manual Settings toggle** (`SET_AUTOSTART`), **default off**.
No Startup-folder entry, no other Run keys, no prior scheduled task, no NSIS/squirrel auto-launch. This
proves only what the *app* does — **it does NOT prove any particular Lenovo is clean.**

**LENOVO RUNTIME AUDIT (per box — MUST be performed physically before deployment):** a specific station
may already have leftover autostart from prior manual setup, imaging, or testing. Before installing,
run these **read-only** checks on the Lenovo and reconcile so the watchdog is the *sole* launcher:
```powershell
# Existing scheduled tasks that might launch VONO/SyncBiz
Get-ScheduledTask | Where-Object { $_.Actions.Execute -match 'SyncBiz|VONO|node' } | Select TaskName,State
# Startup folder entries (user + all users)
Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs\Startup" -ErrorAction SilentlyContinue
# HKCU / HKLM Run keys
Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue
# Was Electron OpenAtLogin previously enabled? (its Run value name is the app id)
Get-ItemProperty "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" -ErrorAction SilentlyContinue | Select-Object * | Out-String -Stream | Select-String -Pattern 'SyncBiz|VONO'
```
**Automatic legacy cleanup:** at install, `provision-vono-protection.ps1` removes **only** the known
legacy VONO autostart Run value (`HKCU\…\Run` → `electron.app.SyncBiz Player`) so "VONO Protection"
becomes the sole launcher. It **never** touches any unrelated / third-party (e.g. YCD) Run, Startup, or
Task entry — those, if present, are reconciled by the physical runtime audit above. The login-item
feature is kept for non-station desktops. VONO's `requestSingleInstanceLock()` is the secondary net
against duplicates.

Do NOT claim a Lenovo is currently clean until the runtime audit above has actually been run on it.

Chain: `Windows logon → "VONO Protection" task → watchdog → VONO → MASTER → playback recovery`.

## Install / provision flow

**App provisioning is fully automatic** — running the installer creates and starts the hidden
"VONO Protection" task and removes the legacy Run value. The remaining steps are **station/OS prep**
(one-time per box, outside the app):

1. **Run the VONO installer** (`.exe`). It stages `vono-watchdog\{node.exe,watchdog.cjs,launch-watchdog.ps1,
   provision-vono-protection.ps1}` **and** provisions + starts the hidden task for the current station user.
   → nothing else to configure for VONO itself.
2. Create a dedicated **local, non-admin** station account (the account the installer is run under / that
   auto-logs in) — if not already the station user.
3. Enable **auto-login** for it (Sysinternals **Autologon** → LSA secret; not plaintext registry).
4. BIOS: **After AC Power Loss = Power On**; no boot-menu pause; TPM-only BitLocker (no boot PIN).
5. Power: **Sleep OFF, Hibernate OFF** (display may turn off). Do NOT globally disable USB selective
   suspend unless Lenovo/audio testing proves it necessary.
6. Windows Update: set **Active Hours** / maintenance window (the watchdog must NOT block updates).
7. Reboot; confirm zero-touch: box powers on → auto-login → **task (auto)** → watchdog → VONO → playback.

> The task is registered for whichever user runs the installer (`$env:USERDOMAIN\$env:USERNAME`). Install
> under (or as) the station user so the AtLogOn trigger fires on the station session.

**Upgrade / reinstall:** just run the newer installer — `Register-ScheduledTask -Force` replaces the task
in place (exactly one, correct user, hidden); no duplicates, no manual steps.

## Uninstall / rollback flow

The **NSIS uninstaller** removes protection automatically: `customUnInstall` ends + deletes the
"VONO Protection" task (`schtasks /End` then `/Delete /F`) and drops the stale
`%ProgramData%\VONO\state\watchdog.lock`. It never kills unrelated processes and never touches VONO
playback; a running VONO keeps playing until closed.

(Manual equivalent, if ever needed outside the uninstaller —
`provision-vono-protection.ps1 -Action uninstall -InstallDir "<install>"`.)

## What to verify physically on the Lenovo BEFORE building an installer
- BIOS "After Power Loss = Power On": `Get-CimInstance -Namespace root\wmi -ClassName Lenovo_BiosSetting | ? CurrentSetting -match 'Power'`.
- Auto-login on: `Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" | Select AutoAdminLogon,DefaultUserName`.
- Power plan: `powercfg /a` shows sleep/hibernate off; display-off allowed.
- No lock screen / screensaver; no first-run dialogs (Edge/OneDrive) blocking the session.
- Windows Update active hours set; no forced business-hour reboots.
- Network auto-connects on boot.
- Audio: correct default output device, unmuted, volume up.
- `C:\ProgramData\VONO` writable by the station user; user can run the task and `taskkill` its own procs.
- Single-instance sanity: launching two VONO leaves exactly one alive.
- Watchdog sanity: `Start-ScheduledTask "VONO Protection"` then check `C:\ProgramData\VONO\logs\watchdog.log` for `[BOOT]` + `[STATE]` lines; start a second copy → it logs `another watchdog owns the lock — exiting`.
