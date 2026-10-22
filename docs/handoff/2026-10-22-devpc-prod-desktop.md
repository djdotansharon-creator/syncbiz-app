# Dev-PC handoff — PROD desktop + Music Bank + Shufersal bank (2026-10-22)

Prompt for a Claude Code session running **on the Dev-PC** (`dsk-9b11bfa1-…`). Paste everything
below the line. This step needs the Dev-PC: Windows installer build, Railway CLI, PROD DB read
access and the installed VONO desktop. A cloud session can do none of those.

---

You are on the Dev-PC. First confirm it: read `C:\ProgramData\VONO\state\device-id.json` and expect
`dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`. If it does not match, STOP. Read `CLAUDE.md` and
`docs/VONO_PILOT_BASELINE.md` before anything else. Follow them strictly (TEST/PROD safety, no secrets
in files or chat, no `desktop-v*` tags, no force push, STOP conditions).

## Owner goal (Dotan, 2026-10-22) — must work TODAY on the Dev-PC only

Run the Dev-PC's VONO desktop against **PROD** (`focused-exploration`) instead of TEST. It must have:
1. the Royalty-Free **Music Bank** playing, including moving on to the next track;
2. the **Shufersal bank**, visible ONLY to allow-listed workspaces (Dotan's, plus Shufersal's if it
   exists) and never to every customer;
3. the **new ElevenLabs jingles** (5 VONO Hebrew voices + gender labels; already in PROD).

**The Lenovo (`dsk-cbeb93d0`) stays on TEST. Do not touch it.** The Lenovo's separate login/no-playback
problem is OUT OF SCOPE here: it gets its own audit session on the Lenovo.

## Facts already established (cloud session)

- All installed desktops (beta.21–23) are TEST-pinned. That is why the desktop shows neither the PROD
  ElevenLabs voices nor the Shufersal bank. PROVEN BY CODE + baseline.
- `main` contains everything from the TEST branch: `origin/main..origin/playback/p0-gate1-url-transition`
  is empty. The committed `desktop/src/main/hosted-url.ts` points at PROD
  (`syncbiz-app-production.up.railway.app` / `wss://syncbiz-ws-production.up.railway.app`), so a PROD
  build needs **no endpoint edits**, only a version bump.
- **CONFIG TRAP (PROVEN BY CODE, `desktop/src/main/runtime-config-service.ts:64`):** for a packaged
  build, `normalizeEndpointsForPackaged` replaces `apiBaseUrl` / `wsUrl` ONLY when they are empty or
  localhost. The Dev-PC's saved runtime config (userData) holds the TEST URLs and a TEST `branchId`. If a
  PROD build is installed over it as-is, the renderer comes from PROD while MAIN keeps talking to the
  TEST API/WS — a split-brain station. You MUST reset those fields before the first launch (step B3).
- PR #58 commit message: the PROD DB already holds the RF bank (177 MediaAsset) + the Shufersal bank
  (100 MediaAsset + 100 LogicalAssetSource, READY). That is a claim from a commit message only — VERIFY
  it read-only (step A2).
- PR #57 (branch `claude/great-planck-2k7lps`) adds `NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES`
  (comma-separated workspace ids, or `*`). The Shufersal pad shows only when
  `NEXT_PUBLIC_SHUFERSAL_BANK_ENABLED=true` AND the workspace is listed; unset list → nobody. **Never
  turn the Shufersal flag on in PROD before PR #57 is merged**, or every customer sees the bank. Merge
  needs Dotan's explicit "מאשר מיזוג". PR #57 also carries radio presets / delete / design and a softer
  login rate limit (10 fails / 5 min).
- 2026-10-22 the Railway dashboard showed "Limited Access — Deploys have been paused due to an upstream
  issue" on the PROD `syncbiz-app` service. If deploys are still paused, NEXT_PUBLIC flags cannot
  rebuild: report that as a blocker, do not work around it.

## Plan — report after each phase; STOP where marked

### A. PROD readiness (read-only first)
1. Railway: check whether deploys on `focused-exploration` are still paused. Paused → STOP and report.
2. PROD DB, read-only (via `DATABASE_PUBLIC_URL`, never print it): count READY MediaAsset +
   LogicalAssetSource rows for the RF catalog (expect 176 mapped) and for the Shufersal bank (expect
   100). Find Dotan's PROD workspace id(s) (and a Shufersal workspace, if one exists).
3. List the PROD app variables by NAME ONLY (never print values): `R2_ACCESS_KEY_ID`,
   `R2_SECRET_ACCESS_KEY`, `R2_S3_ENDPOINT`, `SYNCBIZ_MEDIA_SECRET`, `ELEVENLABS_API_KEY`,
   `NEXT_PUBLIC_RFM_CATALOG_ENABLED`, `NEXT_PUBLIC_SHUFERSAL_BANK_ENABLED`,
   `NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES`. Report which are missing. Dotan pastes secret values himself
   in the Railway UI; you never handle a secret value.
4. **STOP — owner decisions:** (a) `NEXT_PUBLIC_RFM_CATALOG_ENABLED=true` in PROD shows the RF bank to
   EVERY PROD customer — ask Dotan whether that is OK; (b) merge PR #57 ("מאשר מיזוג").
5. After approval: merge PR #57. Dotan sets the flags (RF as decided; Shufersal flag `true` +
   `NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES=<ids from A2>`). Wait for the PROD deploy, then verify:
   `/api/health` 200; signed in as Dotan, the RF pad and the Shufersal pad are visible; one track from
   each bank streams (`/api/media` 200, audio). Also verify a non-listed workspace does NOT see the
   Shufersal pad.

### B. PROD installer — Dev-PC only
1. Build from a clean `main` HEAD (after A5). The ONLY transient edit is the version (e.g.
   `2.2.8-prod.1`). Never create or push a `desktop-v*` tag; never publish. After `dist:win`, run
   `git checkout -- desktop/package.json` and confirm the tree is clean.
2. Verify `app.asar`: PROD hosts only, no TEST host. Record version, source SHA, transient edits,
   SHA256, size, unsigned / not published. Back it up to
   `D:\SyncBiz_Backups\pilot\2026-10-22-prod1-<sha>\`. Keep the current TEST beta binary as the
   Dev-PC rollback.
3. **STOP — show Dotan the exact reset before doing it.** Close VONO with the intentional Exit (so
   Protection does not restart it). Back up the userData runtime-config file. Then clear `apiBaseUrl`,
   `wsUrl` and `branchId` (or remove that file) so the PROD defaults apply. **Do NOT touch**
   `C:\ProgramData\VONO\state\device-id.json`.
4. Install, launch, and check `main.log`: the API and WS hosts are PROD, with no TEST host anywhere.
5. Dotan signs in with his **PROD** password. Activate the station in PROD (Control Room → a branch →
   install code → redeem on the Dev-PC). Confirm one designated MASTER for that zone in the PROD WS logs.
6. Acceptance on the Dev-PC (owner-attested, plus log-corroborated where possible): an RF track plays
   and moves on to the next track; the Shufersal bank is visible and plays; a jingle made with a VONO
   Hebrew voice plays; the menu shows the gender labels.

### C. Lock the baseline
Update `docs/VONO_PILOT_BASELINE.md`: the Dev-PC is now a PROD station (installer record +
rollback); the Lenovo remains TEST (beta.2x); flags set in PROD; PR #57 merged SHA; Railway deployment
ID. Report TEST / PROD / NOT DEPLOYED explicitly for every step.
