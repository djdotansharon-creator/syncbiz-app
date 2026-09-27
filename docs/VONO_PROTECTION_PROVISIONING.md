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
```

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

Template: [`desktop/scripts/provisioning/vono-protection.task.xml`](../desktop/scripts/provisioning/vono-protection.task.xml).
Register/remove: `vono-protection.install.ps1` / `vono-protection.uninstall.ps1`.

| Field | Value |
|---|---|
| Trigger | **At log on** of the dedicated station user (`<LogonTrigger><UserId>…`) |
| Principal | station user, **InteractiveToken**, **LeastPrivilege** (NON-elevated) |
| Program | `<install>\vono-watchdog\node.exe` (absolute) |
| Arguments | `"<install>\vono-watchdog\watchdog.cjs"` (absolute) |
| Working dir | `<install>\vono-watchdog` |
| MultipleInstances | **IgnoreNew** |
| Restart on failure | every **1 min**, max **3** |
| Execution time limit | **PT0S** (no limit — runs 24/7) |
| Start when available | **on** (run ASAP after a missed start) |
| Allow on demand | **on** |
| Batteries/network gating | disabled (`DisallowStartIfOnBatteries=false`, `RunOnlyIfNetworkAvailable=false`) |

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
Reconcile: disable the VONO login-item toggle (Settings) and remove any leftover VONO Run/Startup/Task
entry, so only **"VONO Protection"** launches VONO. The login-item feature is kept for non-station
desktops. VONO's `requestSingleInstanceLock()` is the secondary net against duplicates.

Do NOT claim a Lenovo is currently clean until the runtime audit above has actually been run on it.

Chain: `Windows logon → "VONO Protection" task → watchdog → VONO → MASTER → playback recovery`.

## Install / provision flow
1. Install VONO (NSIS) → `<install>\` incl. `vono-watchdog\{node.exe,watchdog.cjs}`.
2. Create a dedicated **local, non-admin** `vono-station` account.
3. Enable **auto-login** for it (Sysinternals **Autologon** → LSA secret; not plaintext registry).
4. BIOS: **After AC Power Loss = Power On**; no boot-menu pause; TPM-only BitLocker (no boot PIN).
5. Power: **Sleep OFF, Hibernate OFF** (display may turn off). Do NOT globally disable USB selective
   suspend unless Lenovo/audio testing proves it necessary.
6. Windows Update: set **Active Hours** / maintenance window (the watchdog must NOT block updates).
7. Register the task (as/for the station user):
   ```powershell
   powershell -ExecutionPolicy Bypass -File vono-protection.install.ps1 `
     -StationUser "<PC>\vono-station" -InstallDir "<install>"
   Start-ScheduledTask -TaskName "VONO Protection"
   ```
8. Reboot; confirm zero-touch: box powers on → auto-login → task → watchdog → VONO → playback.

## Uninstall / rollback flow
```powershell
powershell -ExecutionPolicy Bypass -File vono-protection.uninstall.ps1        # stop+unregister task, drop stale lock
powershell -ExecutionPolicy Bypass -File vono-protection.uninstall.ps1 -Purge # also remove watchdog-cache.json
```
Idempotent; never touches VONO or playback. To fully revert, also uninstall VONO via its NSIS
uninstaller. Removing the task stops only *protection*; a running VONO keeps playing.

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
