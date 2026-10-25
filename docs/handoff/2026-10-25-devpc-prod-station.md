# Dev-PC handoff — make the Dev-PC a PROD desktop station (2026-10-25)

Supersedes `2026-10-22-devpc-prod-desktop.md` (kept for history). Prompt for a Claude Code session running
**on the Dev-PC**. Paste everything below the line.

---

You are on the Dev-PC. First confirm it: read `C:\ProgramData\VONO\state\device-id.json` and expect
`dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`. If it does not match, STOP. Then read `CLAUDE.md` and
`docs/VONO_PILOT_BASELINE.md` in full and follow them strictly: TEST/PROD safety, no secrets in files or
chat, never create or push a `desktop-v*` tag, no force push, STOP conditions, evidence labels
(`PROVEN BY CODE / TEST / RUNTIME`, `NOT PROVEN`), and report TEST / PROD / NOT DEPLOYED for every step.
Reply to Dotan in Hebrew, in plain language (he is the product owner, not a programmer).

## Goal (Dotan, 2026-10-25)

Turn the Dev-PC into a **PROD desktop station** so the real product can be tested on PROD exactly the way
the pilot works on the Lenovo: the VONO desktop app (MPV) is the branch's designated MASTER, and a browser
tab / the phone are CONTROL. **The Lenovo (`dsk-cbeb93d0-…`) stays on TEST and is NOT touched** — it is the
only accepted pilot reference.

## Facts already established (cloud session — re-verify anything you act on)

- `main` HEAD `ed98d59` contains everything needed: PRs #54–#59, #61, #62 (revert of #60), **#63** (one
  deviceId per browser tab + 10 s web reload window — ACCEPTED IN PROD, owner-attested 2026-10-24) and
  **#64** (a scheduled jingle fires once per branch). PROD (`focused-exploration`, services `syncbiz-app`
  + `syncbiz-ws`) auto-deploys from `main`.
- All installed desktops are TEST-pinned (transient build edits). The committed
  `desktop/src/main/hosted-url.ts` already points at PROD (`syncbiz-app-production.up.railway.app` /
  `wss://syncbiz-ws-production.up.railway.app`) → a PROD build needs **no endpoint edits**, only a
  version bump. PROVEN BY CODE.
- **CONFIG TRAP (PROVEN BY CODE, `desktop/src/main/runtime-config-service.ts`):** for a packaged build,
  `normalizeEndpointsForPackaged` replaces `apiBaseUrl` / `wsUrl` ONLY when empty or localhost. The
  Dev-PC's saved runtime config (userData) holds TEST URLs + a TEST `branchId`. Installing a PROD build
  over it unchanged gives a split-brain station (PROD renderer, MAIN still on the TEST API/WS). Reset
  those fields before the first launch (step B3).
- **Two PROD accounts exist for Dotan:** `djdotansharon@gmail.com` and `vonoservice@gmail.com` (he can sign
  in with both). Each account is its own workspace (own branches, pads, jingles, library, WS room). The
  station must be activated in the SAME workspace Dotan will control it from in the browser / phone —
  ask him which one (step A3) before activating anything.
- Shufersal bank: PR #57 is merged (allow-list `NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES`, fail-closed). The
  PROD variables may still be unset — check by NAME only.
- Known, PARKED — do NOT fix in this session (owner decision): F2, F3, F6 (a promoted browser MASTER does
  not resume playback — browser-only branches; designated rooms never auto-promote), F8 (desktop
  scheduled jingle needs the cloud WS), F9 (browser MASTER: a pad with a pre-roll bell cuts the bell and
  plays the jingle over the music), stale CONTROL display after the MASTER disappears, command ACK /
  idempotency. If one of them shows up in your acceptance run, record it — do not fix it.

## Plan — report after each phase; STOP where marked

### A. PROD readiness (read-only)
1. Railway `focused-exploration`: confirm deploys are not paused and that `syncbiz-app` is ACTIVE on
   `ed98d59` (or later). Paused / failed → STOP and report.
2. PROD app variables, by NAME only (never print values): `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
   `R2_S3_ENDPOINT`, `SYNCBIZ_MEDIA_SECRET`, `ELEVENLABS_API_KEY`, `NEXT_PUBLIC_RFM_CATALOG_ENABLED`,
   `NEXT_PUBLIC_SHUFERSAL_BANK_ENABLED`, `NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES`, `RESEND_API_KEY`. Report
   which are missing.
3. PROD DB, read-only (via `DATABASE_PUBLIC_URL`, never print it): for both emails above —
   `status`, `passwordHash IS NOT NULL` (never the hash), membership count, owned workspace id(s) and
   names, and the branches of each workspace. Count READY MediaAsset / LogicalAssetSource rows for the RF
   catalog and the Shufersal bank.
4. **STOP — owner decisions:** (a) which account / workspace / branch becomes the Dev-PC station;
   (b) whether to enable the RF catalog for every PROD customer (`NEXT_PUBLIC_RFM_CATALOG_ENABLED=true`
   shows it to ALL PROD workspaces); (c) the Shufersal allow-list workspace ids. Dotan sets variable
   values himself in the Railway UI; you never handle a secret value.

### B. PROD installer + station — Dev-PC only
1. Build from a clean `main` HEAD. The ONLY transient edit is the version (e.g. `2.2.8-prod.1`). Never
   create or push a `desktop-v*` tag; never publish. After `dist:win`, run
   `git checkout -- desktop/package.json` and confirm the tree is clean.
2. Verify the built `app.asar`: PROD hosts only, no TEST host anywhere. Record version, source SHA,
   transient edits, SHA256, size, unsigned / not published. Back it up to
   `D:\SyncBiz_Backups\pilot\2026-10-25-devpc-prod1-<sha>\`. Keep the current TEST beta binary as the
   Dev-PC rollback.
3. **STOP — show Dotan the exact reset before doing it.** Close VONO with the intentional Exit (so
   Protection does not restart it). Back up the userData runtime-config file. Clear `apiBaseUrl`,
   `wsUrl` and `branchId` (or remove that file) so the PROD defaults apply. **Do NOT touch**
   `C:\ProgramData\VONO\state\device-id.json`.
4. Install, launch, check `main.log`: API and WS hosts are PROD, no TEST host anywhere.
5. Dotan signs in with the PROD account chosen in A4. Activate the station in PROD (Control Room → the
   chosen branch → install code → redeem on the Dev-PC). Confirm exactly one designated MASTER for that
   zone in the PROD WS logs, and that a browser tab of the same account is CONTROL.

### C. Acceptance on PROD (owner-attested, log-corroborated where possible) — one item at a time
1. Playback: an RF track plays and moves on to the next; NEXT / PREV / SEEK; the Shufersal bank is
   visible only for the allow-listed workspace and plays.
2. Jingles from a browser tab AND from the phone: a pad WITHOUT a bell and a pad WITH a pre-roll bell →
   on the Dev-PC: bell then jingle, music ducked to ~40 % and restored (the volume display dips during
   the duck by design).
3. A jingle made with a VONO Hebrew voice plays; the voice menu shows the gender labels.
4. Scheduled jingle (PR #64) with 2–3 browser tabs of the same account open: daily → exactly once;
   once → once, removed from the list only after it played.
5. Read-only observation (do not fix): with the station playing, close VONO on the Dev-PC (intentional
   Exit) and watch an open browser tab for 1 minute — does it keep showing "playing"? Record the result
   for the parked stale-display item.
6. Regression: close / reopen VONO and restart Windows → zero-touch restore of the last session.

### D. Lock the baseline
Update `docs/VONO_PILOT_BASELINE.md`: the Dev-PC is a PROD station (installer record + rollback, account /
workspace / branch used, Railway deployment ID); the Lenovo remains TEST and untouched; flags set in
PROD; acceptance results with their labels (`ACCEPTED — owner-attested <date>` vs log-corroborated). Commit
docs only, on a new branch, and ask Dotan before opening or merging a PR.
