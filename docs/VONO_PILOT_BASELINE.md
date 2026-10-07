# VONO PILOT KNOWN-GOOD BASELINE

> Operational, changeable state. Update after EVERY runtime-accepted blocker (CLAUDE.md §8).
> Permanent rules live in `CLAUDE.md`. No secrets in this file — ever.
> Evidence labels: `ACCEPTED — owner-attested <date>` (Dotan on the Lenovo; not independently
> inspected by Claude) vs `ACCEPTED — server-log corroborated` (TEST WS/server logs).
> Earlier baselines are kept verbatim-in-substance in §13 HISTORY — never delete history.

## 1. STATUS

- **⭐ P0 PLAYBACK HARDENING — ACCEPTED / BASELINE LOCKED (owner-attested 2026-10-07, TEST).** Desktop
  **2.2.8-beta.12** (SHA256 `3becd1c881c6c847f11c0c10f2f1549c7987be92bb1e83808b36cf8528e49429`) from `dc74457` +
  TEST renderer `3d6a70d` (deployment `a1028a7f`). Accepted commits `e78e8a0`, `3d6a70d`, `2e5b4b8`, `dc74457`
  on `feature/control-room-phase1` (pushed). Full record: `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md`. **No playback code change after this lock
  without a new isolated gate.** URL startup latency PARKED (§9 item 15).
- **Date:** 2026-10-07 (P0 lock); earlier: 2026-10-05 (jingles acceptance recorded 2026-10-06 UTC+3 night)
- **Phase:** PILOT HARDENING
  - **PLAYER PHASE: PILOT ACCEPTED** (owner-attested 2026-10-05)
  - **JINGLES / ANNOUNCEMENTS: PILOT ACCEPTED** (owner-attested 2026-10-05)
- **⭐ P0 URL CONTINUITY + OWNERSHIP — ACCEPTED / LOCKED (2026-10-07, TEST, RENDERER ONLY)** — `8e8895a` (URL EOF →
  next URL) + `d617314` (stale LOCAL AUTOMIX can never take over a MAIN URL session); TEST app deployment `3f258faf`.
  **Current renderer / playback baseline = `d617314`** (Desktop stays 2.2.8-beta.12). Lenovo owner-attested with
  main.log evidence (EOF attempt 1000000001 → 283 ms → LOADFILE 1000000002 kind url; no LOCAL takeover). Record:
  `docs/P0_URL_CONTINUITY_OWNERSHIP_ACCEPTANCE_2026-10-07.md`. No playback change without a new isolated gate.
- **CONTROL ROOM F2a — MEMBER SCOPE FOUNDATION (SHADOW / OFFLINE): ACCEPTED** (2026-10-07, TEST only) — commit
  `398cce7`, app deployment `54f898f9`, migration `20261007150000_control_room_f2a_member_scope`. Scopes stored +
  evaluated OFFLINE only (nothing enforces / no request path reads them); TEST matrix 36/36 agree, 0 unexpected.
  **F2b NOT started.** Record: `docs/CONTROL_ROOM_F2A_ACCEPTANCE_2026-10-07.md`.
- **CONTROL ROOM F1 — BRAND + ZONE FOUNDATION (SHADOW): ACCEPTED** (2026-10-07, TEST only) — commit `25d4c06`, app
  deployment `538902e8`, migration `20261007120000_control_room_f1_brand_zone`. Default brand `11db397d…` (MAIN),
  default zone `6739408a…` (MAIN) on canonical branch `90d2b7b8…`. Nothing reads Brand/Zone at runtime yet. **F2 NOT
  started.** Record: `docs/CONTROL_ROOM_F1_ACCEPTANCE_2026-10-07.md`.
- **Current active P0:** none (P0 playback hardening accepted 2026-10-07). Next architecture step: Control Room
  **Foundation Gate — Brand + Zone + composite permission scopes** (blueprint `docs/CONTROL_ROOM_BLUEPRINT.md`,
  D14–D22; no schema/runtime work started).
- **CONTROL ROOM PHASE 1 — GATE 1 (canonical branch, SHADOW): FULL PASS / ACCEPTED** (2026-10-06, TEST only)
  on branch `feature/control-room-phase1` (NOT PR #52, which stays FROZEN at its accepted head). Gate 2
  (activation / "default" migration) NOT started. See §7 "CONTROL ROOM PHASE 1".
- **CONTROL ROOM GATE 2A-1 (identity/authorization compatibility): ACCEPTED** (2026-10-06, TEST only) —
  commit `2466820`, TEST app deployment `b6050fc1`. See §7 "GATE 2A-1".
- **CONTROL ROOM GATE 2A-2 (identity data migration): ACCEPTED** (2026-10-06, TEST only) — identity rows now on
  canonical branch `90d2b7b8…`. See §7 "GATE 2A-2".
- **CONTROL ROOM GATE 2A-3 (canonical WS room activation): ACCEPTED** (2026-10-06, TEST only) — commit
  `384df45`, WS deployment `23e94c01`. Live room is now `ws:31d30e23…:90d2b7b8…`; content rows still on
  "default". See §7 "GATE 2A-3".
- **CONTROL ROOM GATE 2B-1 (content branch compatibility): ACCEPTED** (2026-10-06, TEST only) — commit
  `9e06f40`, app deployment `8273a78b`. Content reads accept "default" + canonical; NEW content writes canonical;
  See §7 "GATE 2B-1".
- **CONTROL ROOM GATE 2B-2 (content data migration): ACCEPTED** (2026-10-06, TEST only) — all TEST content rows now
  on canonical `90d2b7b8…` (Playlist 6, JinglePadAssignment 4, Announcement 1; 0 on "default"). **GATE 2B
  COMPLETE.** See §7 "GATE 2B-2".
- **CONTROL ROOM GATE 3A (capability engine, SHADOW): ACCEPTED** (2026-10-06, TEST only) — commit `dd4ea6b`, app
  deployment `d02448b1`. Mode SHADOW (nothing enforced). See §7 "GATE 3A"; 3B items in §9 item 11.
- **CONTROL ROOM GATE 3B-1 (active-workspace isolation): ACCEPTED** (2026-10-06, TEST only) — commit `23ff679`, app
  deployment `062d3827`. Closes §9 items 11b + 11c. See §7 "GATE 3B-1".
- **CONTROL ROOM GATE 3B-2 (schedule cross-workspace IDOR): ACCEPTED** (2026-10-06, TEST only) — commit `cdebde5`,
  app deployment `d9d1dda5`. Closes §9 item 11a. See §7 "GATE 3B-2".
- **CONTROL ROOM GATE 3B-3 (user-management hardening): ACCEPTED** (2026-10-06, TEST only) — commit `c5ddf8b`, app
  deployment `85d08dca`. Closes §9 item 11e + the cross-workspace password / global-disable takeover paths;
  existing-user invite consent PARKED (§9 item 13). See §7 "GATE 3B-3".
- **CONTROL ROOM GATE 3B-4a (retire dead / legacy command routes): ACCEPTED** (2026-10-06, TEST only) — commit
  `2cb46d2`, app deployment `f8d3bc55`. Closes the command-route part of §9 item 11d (announcements / logs /
  metadata-proxy remain for 3B-4b..d). Authz mode still SHADOW. **Gate 3B-4b NOT started.** See §7 "GATE 3B-4a".
- **PR #52:** OPEN — **NOT MERGED / DO NOT MERGE** without explicit approval
- **PROD:** UNTOUCHED
- **Written from:** Dev-PC (`dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`) — no direct Lenovo log access.

## 2. GIT

| Item | Value |
|---|---|
| Repository | `D:\APP Project\syncbiz-app` |
| Branch | `fix/local-playback-designated-master-prb` |
| PR | #52 — OPEN / NOT MERGED |
| **CURRENT PR HEAD** | the **docs-only** commit `docs(pilot): accept Jingles and beta.10 runtime baseline`, whose parent is `cd4c631`. A commit cannot contain its own SHA — read it with `git rev-parse origin/fix/local-playback-designated-master-prb`. |
| **RENDERER + MAIN APPLICATION BASELINE** | `cd4c631fc90570f062040def825f0c91bcff5bc3` — accepted application/runtime source (player phase `2ebdbe4` + jingles P0) |
| **DESKTOP beta.10 SOURCE LINEAGE** | `cd4c631fc90570f062040def825f0c91bcff5bc3` + documented temporary TEST build pins (see §5) |
| **DESKTOP AUTHORITATIVE ARTIFACT** | `2.2.8-beta.10`, SHA256 `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| main / PR base | `951a44cd99f39d921e217d246f6422b49cee2941` (verified after fresh fetch) |
| Working tree when written | clean at `cd4c631` (before this docs-only commit) |
| Stash present | `stash@{0}` = `pr52-xfade-diag-hold` (temporary diagnostic, see §9) |

Meaning: `cd4c631` is the exact application/runtime source accepted for the pilot (renderer AND desktop
MAIN). Everything above it is **documentation only**. **No application source changed after `cd4c631`.**
Verify with `git diff --stat cd4c631..origin/fix/local-playback-designated-master-prb`.
Lineage: `865ba81` (offline cold boot, MAIN) → `2ebdbe4` (renderer stall fix) → `17a1b84` (docs) →
`cd4c631` (jingles: MAIN PLAY_INTERRUPT + Preview safety).

## 3. TEST ENVIRONMENT

| Item | Value |
|---|---|
| Railway project | `syncbiz-pr52-test` |
| Renderer (app) | https://syncbiz-app-test-production.up.railway.app (HTTP 200; `/api/health` status ok, database ok, yt-dlp ok) |
| WS | wss://syncbiz-ws-test-production.up.railway.app |
| Renderer Railway deployment ID | `b591c130-4112-433a-a928-6f0f424a5dce` (SUCCESS, 2026-10-06 00:26:49 +03:00) |
| Renderer image digest | `sha256:4b1e5ef4414f399869f1e72b2002ea09dad63eaa6992bee6f7b3c2f75cad4b11` |
| TEST DB | Postgres inside `syncbiz-pr52-test` (test secrets stored outside the repo — never here) |
| **ElevenLabs** | `ELEVENLABS_API_KEY` configured on `syncbiz-app-test` by the owner (verified by NAME only; value never read) |
| **App volume** | `syncbiz-app-test-volume` (id `4272e7c6-1518-436d-9da0-1fe1c7c5e54f`) attached to `syncbiz-app-test` only, mount path **`/data`**; Railway exposes `RAILWAY_VOLUME_MOUNT_PATH=/data` |
| **Jingle storage** | generated MP3s under **`/data/jingles/<uuid>.mp3`**, served at `/api/jingles/audio/<uuid>` |
| **WS volume (2026-10-06)** | `syncbiz-ws-test-volume` (id `18b32178-da30-484f-8403-785b347baf73`) on `syncbiz-ws-test` only, mount `/data` → designation / lease / branch-alias state in `/data/ws-lease/` (proven to survive redeploy with no re-assertion) |
| **Control Room Phase 1 deploys (2026-10-06)** | app `87a05469-b3f5-4afc-819a-c33746e0182e` (source `6b5b9a0`, file-hash verified for the changed renderer files); WS `335dad0a-e3a4-4802-b1b6-c9ae40697e51` (Gate 1 shadow code `cea1585`) |
| **TEST DB backup before Gate 2B-2** | `D:\SyncBiz_Backups\test-env\20261006T145008Z-gate2b2\` (pg_dump sha256 `d6a5c882ceef7808ea62310db113b82f8f95e8ba370c7d6004bcff813fb1dbb7`, 241240 B; **restore test PASS** — 13 counts identical, throwaway DB dropped) + `gate2b2-manifest.json` (sha256 `f6893d7050a0813c6921a6d8a8164ade31a57786765daf3dd8d2416e644d494b`; also on TEST app volume `/data/control-room/gate2b2-manifest.json`) + `BACKUP-RECORD.txt`. Git HEAD at backup `2d2ccdf` |
| **P0 URL continuity + ownership deploy (2026-10-07)** | app **`3f258faf-d90b-4f5d-8bbf-d2246e7aec8b`** (= `d617314`, incl. `8e8895a`; clean tree; changed renderer files hash-verified). WS / desktop / DB unchanged |
| **Control Room F2a deploys (2026-10-07)** | deploy A `8a9e36f9-1526-4f04-9858-5938e629581a` (= `25d4c06` + F2a migration folder only → `prisma migrate deploy`); deploy B **`54f898f9-bd3c-4267-ba42-5b3edad36a8f`** (= `398cce7`, clean tree, hash-verified). WS NOT redeployed (`23e94c01`) |
| **TEST DB backup before F2a** | `D:\SyncBiz_Backups\test-env\20261007T104212Z-control-room-f2a\` (pg_dump sha256 `c2b8d7edd03ec011bb3876707c8d67c1daaf7ffc974fa132de3842286ad9c5b7`; **restore test PASS**; pre/post fingerprints) |
| **Control Room F1 deploys (2026-10-07)** | deploy A `bbb98798-8487-4e43-b308-a101b34e402c` (= `483fd28` + F1 migration folder only → `prisma migrate deploy`); deploy B **`538902e8-439d-46c4-a38d-ea978c7baaac`** (= `25d4c06`, clean tree, changed files hash-verified). WS NOT redeployed (`23e94c01`) |
| **TEST DB backup before F1** | `D:\SyncBiz_Backups\test-env\20261007T094829Z-control-room-f1\` (pg_dump sha256 `4d9ea2da808c4fa19bdb0f63d40ea4ae72ccfb5564ea63dd7fd81bcf0e2bc22b`; **restore test PASS**; pre/post fingerprints) |
| **Gate 2B-1 app deploy (2026-10-06)** | app `8273a78b-8b93-476a-9625-6d4983717d05` (SUCCESS 14:13Z; source `9e06f40`, clean tree; all 12 changed source files hash-verified). WS NOT redeployed |
| **Gate 2A-3 WS deploy (2026-10-06)** | WS `23e94c01-38ba-4dde-9f22-336bb304bdde` (SUCCESS 11:37Z; source `384df45`, clean tree). Previous shadow WS build `335dad0a…` = rollback reference (rollback also needs the legacy WS files from the Gate 2A backup) |
| **Canonical TEST branch** | `90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2`, code `T001`, "TEST Pilot Branch (legacy default)", `legacyKey="default"`; **since Gate 2A-3 the WS routes the TEST workspace by this canonical id** (clients still send `"default"`; content rows still `"default"` until Gate 2B) |
| **Gate 2A-1 deploy (2026-10-06)** | app `b6050fc1-e762-49d1-af2d-b4f6677abc8d` (SUCCESS 10:10Z; source `2466820`, all 9 changed files hash-verified: live = working tree, LF-normalized = commit). WS NOT redeployed (still `335dad0a…`) |
| **TEST DB backup before Gate 2A** | `D:\SyncBiz_Backups\test-env\20261006T100051Z-gate2a\` (pg_dump sha256 `aff8197d9b048f121fc81e8c4c58a69246136e800affa7aede4307c3c429fc46`; **restore test PASS** — row counts matched, throwaway DB dropped) + WS designation / lease / alias file copies (hashed); `BACKUP-RECORD.txt` inside. Git HEAD at backup `273f042` |
| **TEST DB backup before Gate 1** | `D:\SyncBiz_Backups\test-env\20261006T050718Z-control-room-gate1\` (pg_dump sha256 `a0a65c1d…d13e`, restore-verified) + WS state file copies |

**PROD untouched.** No PROD deploy, DB, WS, variable, volume or installer action in this baseline.

## 4. LENOVO PILOT STATION

| Item | Value | Evidence |
|---|---|---|
| durableDeviceId | `dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f` | server-log corroborated (TEST WS REGISTER) |
| branch | `default` | server-log corroborated |
| workspace (TEST) | `31d30e23-8f4a-4bf2-a1df-c707b69b5673` | verified 2026-10-06 from the TEST DB (`BranchMasterDesignation`) + TEST WS designation file (`ws:31d30e23-…:default`) |
| workspace (PROD — not this pilot env) | `f2366813-341d-46ba-a6b8-92d2c1fd39b1` | PROD designation of the same Lenovo (2026-10-02); earlier versions of this file wrongly listed it as the TEST workspace — corrected 2026-10-06 |
| Installed Desktop | `2.2.8-beta.12` (since 2026-10-07; before: beta.10) | **OWNER-ATTESTED / NOT DIRECTLY VERIFIED FROM THIS MACHINE** |
| Embedded renderer WS id | `ba8ffdba-d00b-468d-bf74-f805013d37ef` (CONTROL) | server-log corroborated (earlier sessions) |

## 5. DESKTOP INSTALLER (ACCEPTED)

### CURRENT — `2.2.8-beta.12` (P0 playback hardening, accepted owner-attested 2026-10-07)

| Item | Value |
|---|---|
| Version | `2.2.8-beta.12` |
| Desktop source lineage | `dc744575e97279358e6794687ed37d408706677d` (branch `feature/control-room-phase1`) |
| Artifact | `SyncBiz-Player-Setup-2.2.8-beta.12-x64.exe` |
| SHA256 | `3becd1c881c6c847f11c0c10f2f1549c7987be92bb1e83808b36cf8528e49429` |
| Size | 140,772,149 bytes · unsigned · **NOT published** · **TEST-pinned** |
| Transient build edits (reverted) | `hosted-url.ts` → TEST app + TEST WS; `normalizeEndpointsForPackaged` → force TEST endpoints; `desktop/package.json` version → `2.2.8-beta.12` |
| Accepted copy | `D:\SyncBiz_Backups\pilot\2026-10-07-beta12-p0-accepted\` (hash verified) · candidate copy `…\2026-10-07-beta12-dc74457\` |
| Details | `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md` |

### PREVIOUS — `2.2.8-beta.10` (jingles baseline; now a rollback reference)

| Item | Value |
|---|---|
| Version | `2.2.8-beta.10` |
| Desktop source lineage | `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| Artifact | `SyncBiz-Player-Setup-2.2.8-beta.10-x64.exe` |
| SHA256 | `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| Size | 140,769,315 bytes |
| Environment | **TEST-pinned** |
| Signing | unsigned |
| Published | **NO** |
| Accepted copy | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-accepted\` (+ `SHA256.txt`, `README.txt`; hash verified) |
| Candidate copy (kept) | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-candidate\` |
| Older rollback artifacts | beta.9 — `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\`; beta.8 — `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (see §13) |

**Important:** beta.10 was built from `cd4c631` **plus temporary TEST pin edits**, reverted after the
build: `desktop/src/main/hosted-url.ts` → TEST app + TEST WS; `normalizeEndpointsForPackaged` → force
TEST endpoints on every packaged load; `desktop/package.json` version → `2.2.8-beta.10`.
Packaged `app.asar` verified: version beta.10; TEST app/WS only (0 PROD hosts on executable lines);
`case "PLAY_INTERRUPT"` + `resolveInterruptUrl` compiled; beta.9 offline renderer cache present.
**`cd4c631` alone cannot reproduce the binary — the artifact hash is authoritative.** Committed
`hosted-url.ts` points at PROD.

## 6. RENDERER

| Item | Value |
|---|---|
| Accepted renderer source | `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| Railway deployment ID | `b591c130-4112-433a-a928-6f0f424a5dce` |
| Deploy method | `railway up` from a **clean** working tree (Railway metadata carries no commit hash) |

**Verification (2026-10-06, read-only, `railway ssh` into the TEST container):** deployed
`components/jingles-control/JinglesShell.tsx` byte-identical to `cd4c631`; `components/audio-player.tsx`
unchanged since `2ebdbe4` (byte-identical). Jingle MP3s on `/data` survived this redeploy.
**Confidence:** source verified at file-hash level for the changed files; exact commit-to-deploy linkage
**NOT CRYPTOGRAPHICALLY PROVEN** (no commit hash in Railway metadata).

## 7. RUNTIME ACCEPTED

### P0 URL CONTINUITY + OWNERSHIP — ACCEPTED — owner-attested 2026-10-07 (Lenovo, beta.12 + TEST renderer `d617314`)

- **Owner-attested (main.log values supplied by the owner):** LOCAL queue present in the background; URL attempt
  1000000001 played with no LOCAL takeover; `MPV_ENDFILE reason:"eof" attemptId:1000000001` → 283 ms →
  `MPV_LOADFILE attemptId:1000000002 kind:"url"`. URL ownership PASS · URL EOF → next URL PASS · LOCAL takeover
  BLOCKED · duplicate load NONE. Earlier: saved YouTube album auto-advanced URL → URL with no manual NEXT.
- **Server-log corroborated:** MAIN MASTER (trusted station) + renderer CONTROL in canonical room; 0 × 409.
- Commits `8e8895a` + `d617314` · tag `pilot-baseline/2026-10-07-renderer-d617314` · details `docs/P0_URL_CONTINUITY_OWNERSHIP_ACCEPTANCE_2026-10-07.md`.

### CONTROL ROOM F2a — MEMBER SCOPE FOUNDATION (SHADOW / OFFLINE) — ACCEPTED (2026-10-07, TEST, branch `feature/control-room-phase1`)

- **Server / DB corroborated:** after the owner's normal exit + reopen — desktop token 200 ×2, ws-token 200 ×2, register
  200 ×3; durable id `dsk-cbeb93d0…` unchanged; MAIN MASTER (10:51:31Z, trusted station) and renderer CONTROL in canonical
  room `ws:31d30e23…:90d2b7b8…`; 0 × 409; only 5xx = 2 × pre-existing music-bank 503. MemberScope check ok (1 row:
  ADMIN + allLocations); matrix 36/36 agree, 0 unexpected; F1 check ok; fingerprint 0 diffs (18 groups).
- Static: evaluator imported by nothing in app / lib / server / desktop; `lib/authz.ts` / `shadowAuthorize`, token, WS,
  station and desktop files unchanged vs F1.
- Commit `398cce7` · tag `pilot-baseline/2026-10-07-control-room-f2a-398cce7` · details `docs/CONTROL_ROOM_F2A_ACCEPTANCE_2026-10-07.md`.

### CONTROL ROOM F1 — BRAND + ZONE FOUNDATION (SHADOW) — ACCEPTED (2026-10-07, TEST, branch `feature/control-room-phase1`)

- **Server / DB corroborated:** Lenovo MAIN MASTER (10:03:04Z, trusted station) and renderer CONTROL in canonical room
  `ws:31d30e23…:90d2b7b8…`; canonical branch → default brand MAIN; exactly one default zone MAIN; both stations + the
  Lenovo designation resolve to it; no Branch id "default"; no fake station / designation rows; content fingerprint
  0 diffs vs pre-migration; desktop token / register / ws-token 200, 0 × 409; F1 check `ok`; second backfill = no-op.
- **Owner-attested (Lenovo, beta.12):** token/register PASS, durable station id preserved, MAIN MASTER, renderer CONTROL,
  LOCAL / LOCAL NEXT / URL PASS, no 409, no branch conflict, no watchdog restart.
- Commit `25d4c06` · tag `pilot-baseline/2026-10-07-control-room-f1-25d4c06` · details `docs/CONTROL_ROOM_F1_ACCEPTANCE_2026-10-07.md`.

### P0 PLAYBACK HARDENING — ACCEPTED — owner-attested 2026-10-07 (Lenovo, Desktop beta.12 + TEST renderer `3d6a70d`)

Accepted on the Lenovo (Dotan; this Dev-PC session did not inspect Lenovo logs): correct URL trackIndex · URL
NEXT/PREV queue coherence · no LOCAL contamination during a URL session · fresh MAIN attemptId per WS load · watchdog
does not falsely restart during slow URL resolution · recovery kill cancellation · source-aware URL load timeouts ·
crossfade does not start on duration alone · stream crossfade waits for real MPV progress · coreIdle /
pausedForCache gating · outgoing audio audible during long URL buffering · promotion volume + pause normalization ·
URL → LOCAL · LOCAL NEXT after URL · LOCAL automatic transition · no playback gap · no watchdog restart · no force kill.
Server-verified (read-only, 2026-10-07): live TEST renderer files hash-identical to `3d6a70d`.
Commits `e78e8a0` (RENDERER ONLY) · `3d6a70d` (test) · `2e5b4b8` (DESKTOP MAIN + WATCHDOG) · `dc74457` (DESKTOP MAIN).
Tags `pilot-baseline/2026-10-07-desktop-beta12-dc74457`, `pilot-baseline/2026-10-07-renderer-3d6a70d`.
Root causes / fixes: §8 and `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md`.

### CONTROL ROOM GATE 3B-4a — RETIRE DEAD / LEGACY COMMAND ROUTES — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`2cb46d2`** (APP only, security): `/api/player/commands` (GET, POST), `/api/play-now` (POST),
  `/api/commands/play-local` (POST), `/api/commands/stop-local` (POST), `/api/agent/commands` (GET) → **410 Gone**
  (`{"error":"Gone"}`) and nothing else: no process execution (`cmd /c start` / `taskkill`), no agent-queue drain, no
  in-memory player-state mutation, no global-log write, no console echo of request target / path / device. The route
  files import only `next/server`. Legacy UI callers (fire-and-forget) left unchanged.
- Audit basis (3B-4): these routes were unauthenticated; `play-local` / `player/commands` wrote client-supplied targets
  (possibly LOCAL paths) to the global log served by the anonymous `/api/logs` and to the server console; on Linux they
  never executed (Windows-only guard); `play-now` was dead; nothing enqueued agent commands.
- Tests: `scripts/verify-gate3b4a-retired-routes.ts` 14/14 (runtime 410s, exec spies, queue / player-state / global-log
  intact, zero console output, no echo; static imports; jingles/audio + jingles/bell untouched; authz SHADOW) + full
  regression matrix (22 suites) + typecheck + `next build` PASS.
- TEST app deployment `f8d3bc55` (5 retired files + jingles/audio + jingles/bell hash-verified).
- **Runtime — server-log corroborated:** across **1,629 TEST HTTP requests (19:38:44Z → 19:47:34Z)** covering three VONO
  reopens and the URL test: **zero hits on any retired route, zero 410s**; `/api/jingles/audio/:id` and
  `/api/jingles/bell/*` 200 from the beta.10 player; MAIN MASTER (19:40:21Z, 19:41:07Z, 19:47:04Z) + renderer CONTROL in
  the canonical room; no 403 / 409 / branch_conflict. URL playback makes no app-API playback call (renderer → WS →
  MAIN → MPV). The two `POST /api/music-bank/authorize` 503s are pre-existing TEST configuration ("not configured").
- **ACCEPTED — owner-attested 2026-10-06:** VONO reopen; MASTER badge; LOCAL; URL playlist play; URL NEXT; URL → LOCAL;
  On-Air over URL; pads + playlists; Access Control; no visible error.
- Observation recorded separately: excessive `/api/schedules` polling (§9 item 14).
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3B-3 — USER-MANAGEMENT HARDENING — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`c5ddf8b`** (APP only, security): closes §9 item 11e (MANAGER → OWNER escalation) and the two takeover
  paths found in its audit.
  - `requireWorkspaceAdmin()` (WORKSPACE_ADMIN or SUPER_ADMIN membership, ACTIVE, in the ACTIVE workspace) replaces
    `requireAdmin` on `admin/users` GET / POST / PATCH / DELETE and pause- / resume- / remove-member. **MANAGER
    (HQ_CONTROL) → 403** on all of them, incl. the user list. `admin/audit` unchanged (separate product decision).
  - Rank / ownership rules (`lib/admin/user-management-policy.ts`): only the **Workspace Owner** (or platform
    SUPER_ADMIN) creates / promotes / modifies / pauses / resumes / removes another WORKSPACE_ADMIN; a non-owner admin
    manages lower ranks only; the **owner row can never be demoted / paused / removed / disabled** (no implicit
    ownership transfer); the **last active admin cannot be demoted**.
  - **Global password:** PATCH `newPassword` only for self or a platform SUPER_ADMIN; a workspace invite never sets or
    changes an existing user's global password → **cross-workspace password takeover FIXED**.
  - **Global disable** (`DELETE` → `User.status`): platform SUPER_ADMIN only → **tenant global-disable takeover
    FIXED**; workspace-level removal stays on remove-member.
- Audit proof (pre-fix, real handlers over a fake workspace): MANAGER could create / promote / self-promote to
  WORKSPACE_ADMIN, demote the owner, reset the owner's password, pause / remove / globally disable admins; any admin
  could invite an existing user from another workspace and overwrite their global password. Post-fix
  `scripts/verify-gate3b3-user-management.ts` 45/45 (MANAGER / non-owner admin / owner / platform / takeover chains /
  last admin / existing guards / static). Full regression matrix (21 suites) + typecheck + `next build` PASS.
- TEST app deployment `85d08dca` (all 6 changed files hash-verified).
- **Runtime (regression only; no TEST user created / edited / paused / removed / disabled / password-changed):**
  server-log corroborated VONO reopen 19:06:55Z → MAIN MASTER 19:06:56Z + renderer CONTROL 19:06:58Z in the canonical
  room; token mint normal; no 401 / 403 / 409 / branch_conflict. TEST DB: 1 user (ACTIVE), 1 membership
  (WORKSPACE_ADMIN / ACTIVE) — unchanged.
- **ACCEPTED — owner-attested 2026-10-06:** Access Control loads and lists users; VONO reopened; MASTER badge; LOCAL;
  On-Air; pads + playlists normal; no visible error. Privilege protections accepted from the focused test.
- Existing-user invite consent remains **PARKED** (§9 item 13).
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3B-2 — SCHEDULE CROSS-WORKSPACE IDOR — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`cdebde5`** (APP only, security): closes §9 item 11a.
  - GET / PATCH / DELETE `/api/schedules/[id]` load the schedule ONLY from the active session workspace via new
    `db.findScheduleInWorkspace` (id + workspaceId in the query; fails closed; resolved like the list/create routes).
    Not found or another workspace → **404** BEFORE any owner wildcard / branch / alias logic (existence not revealed).
    The "log mismatch and fall through" path is removed.
  - Writes are workspace-bound: `updateSchedule` / `deleteSchedule` require the workspace and use `updateMany` /
    `deleteMany` where `{ id, workspaceId }`; 0 rows → 404 (no check/write race). The fail-open `getSchedule` path is
    not used.
  - Same-workspace behavior unchanged (owner / admin, branch user incl. legacy alias, 403 on unassigned branch, 401
    without session). List / create routes, target validation, browser schedule execution and 3A shadow hooks
    untouched.
- Audit proof (pre-fix, real handlers over a fake two-workspace DB): OWNER of A could GET / PATCH (rename) / DELETE
  Schedule B (all 200). Post-fix `scripts/verify-gate3b2-schedule-idor.ts` 19/19: cross-workspace GET / PATCH / DELETE
  → **404** with Schedule B unchanged (incl. legacy "default" branch user and B canonical branch); same-workspace 200;
  unknown id 404; no session 401; unassigned branch 403; no id-only write executed. Full regression matrix (20 suites)
  + typecheck + `next build` PASS.
- TEST app deployment `d9d1dda5` (both changed files hash-verified).
- **Runtime (regression only, by owner decision — no Schedule row created, to keep §9 item 9 out of this gate):**
  server-log corroborated VONO reopen 18:35:22Z → MAIN MASTER 18:35:32Z + renderer CONTROL 18:35:36Z in the canonical
  room; token mint normal; no 401 / 403 / 409 / branch_conflict. TEST DB still 0 Schedule rows, 1 Branch row.
- **ACCEPTED — owner-attested 2026-10-06:** VONO opened normally; MASTER badge; LOCAL; On-Air; pads + playlists
  normal; Access Control loads; no visible error. Cross-workspace behavior accepted from the focused test.
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3B-1 — ACTIVE-WORKSPACE ISOLATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`23ff679`** (APP only, security): closes the primary-workspace privilege leak (§9 11b) and the bearer
  workspace drift (§9 11c).
  - Auth helpers take the ACTIVE workspace explicitly (`hasBranchAccess`, `hasTenantAdminRole`,
    `getAccessTypeForUser`, `getAssignedBranchIdsForUser`, `isOwner`, `isBranchUser`, `requireBranchAccess`);
    `requireAdmin` uses the session user's `tenantId`; missing workspace → fail closed. All 20 route call sites pass
    `user.tenantId`.
  - `getTenantRole` with an explicit workspace: membership role or **null** (no primary fallback); a non-member gets no
    branches (never the implicit "default").
  - Bearer API auth: `verifyWsTokenClaims` (token format unchanged) → user resolved in the token's **signed**
    workspace + `enforceTokenWorkspaceScope`; **missing workspace claim → DENY**; non-member workspace → DENY.
  - `lib/playlist-access.ts` fallback (no active workspace) → **403 fail closed**.
- Audit proof (pre-fix, real helpers over a fake two-workspace DB): ADMIN in primary A + CONTROLLER/VIEWER in active B
  had `requireAdmin` / `isOwner` / `"*"` / any-branch access in B. Post-fix (`scripts/verify-gate3b1-active-workspace.ts`
  33/33, real signed cookies + tokens): all DENY in B; reverse case (admin only in active workspace) now correctly
  ALLOW; inverse / no-membership / bearer cases fail closed; single-workspace behavior unchanged. Full regression
  matrix (19 suites) + typecheck + `next build` PASS.
- TEST app deployment `062d3827` (all 16 changed files hash-verified).
- **Runtime — server-log / DB corroborated:** VONO reopen 18:01:20Z → MAIN MASTER + renderer CONTROL 18:01:40Z in the
  canonical room; token mint normal; `playlists/[id]:PUT` ×3 succeeded (content.manage ALLOW, workspace `31d30e23…`);
  no 401 / 403 / 409 / branch_conflict / `bearer_missing_workspace`. Branch-master: unauthenticated GET → 401; TEST
  owner membership WORKSPACE_ADMIN / ACTIVE (single membership) → `isOwner(user, activeWs)` true; Gate 3A shadow
  `master.designate` ALLOW; designation intact. (Owner-session GET not exercised — accepted by owner.)
- **ACCEPTED — owner-attested 2026-10-06:** VONO opened normally; MASTER badge; LOCAL; On-Air; pads visible;
  playlists visible + editable; Access Control loads; no visible error (screenshot).
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3A — CAPABILITY ENGINE (SHADOW) — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`dd4ea6b`** (APP only): `lib/authz.ts` = ONE centralized `authorize(subject, capability, branchIds)`
  resolved from the **ACTIVE SESSION WORKSPACE only** (no primary-workspace fallback; no membership / SUSPENDED →
  DENY). Mode code constant OFF | SHADOW | ENFORCE = **SHADOW**.
- Capabilities: playback.control, announcement.send, schedule.edit, users.manage, master.designate, monitoring.view,
  campaign.manage, branches.manage, **content.manage (new)**. Locked presets (owner decisions 2026-10-06): SUPER_ADMIN /
  WORKSPACE_ADMIN → ADMIN (all); **MANAGER → HQ_CONTROL** (ALL scope; operational + content; no users / master /
  branches); REGIONAL_MANAGER operational (branch-scoped until a region model); BRANCH_MANAGER (incl. all API-created
  BRANCH_CONTROLLER rows) → playback + announcement + monitoring; VIEW_ONLY / VIEWER → monitoring only. Legacy
  "default" ≡ canonical only inside the workspace.
- Shadow hooks (fire-and-forget, never awaited, never block; placed after each route's existing gate): playback
  (`playlists/play`), schedules, admin users / members, branch-master, branches, content (playlists, sources, radio,
  AI build, add-from-catalog, jingle pads / library / generate) + would-be capability summary at the 3 token mint
  routes. Structured `[VONO authz] shadow` log with safe identifiers only.
- Tests: `scripts/verify-gate3a-authz.ts` 36/36 (ADMIN / HQ / REGIONAL / BRANCH / VIEW presets, scope, active
  workspace vs primary, cross-workspace / cross-branch DENY, fail closed, shadow never blocks / never throws, safe
  logging, hook coverage) + full regression matrix (18 suites). Typecheck + `next build` PASS.
- TEST app deployment `d02448b1` (all 24 changed files hash-verified).
- **Runtime — server-log / DB corroborated:** active workspace `31d30e23…` on every decision; token-mint summaries
  (preset ADMIN: playback / announcement / monitoring / master.designate ALLOW); **content.manage ALLOW** observed for
  `playlists/[id]:PUT` ×4, `jingles/generate:POST` ×2, `jingles/library:POST`, `jingles/pads:POST` (new pad
  `pad-meat` created **canonical**, no duplicate pad); no unexpected DENY; no 403 / 409 / branch_conflict; MAIN MASTER
  + renderer CONTROL unchanged in the canonical room; nothing blocked. Not exercised at runtime (test-proven only):
  schedule.edit, users.manage, branches.manage, existing-pad update-in-place.
- **ACCEPTED — owner-attested 2026-10-06:** normal VONO use (reopen, playlist playback, On-Air, pad save outside
  fullscreen) with no behavior change.
- No DB / schema / WS / desktop change; nothing enforced. **PROD untouched.**

### CONTROL ROOM GATE 2B-2 — CONTENT DATA MIGRATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`) — GATE 2B COMPLETE
- Script **`scripts/control-room/migrate-content-2b2.mjs`** (commit `bb6a4d2`; exact file executed on TEST, sha256
  `8d19a2ee…f29c`): dry-run / apply / reverse; explicit workspace + canonical args (refuses "system"); exact
  expected counts; pad-conflict fail-safe (no merge / delete / guess); exact-id updates in ONE transaction; manifest
  (table, id, old/new branch, content fingerprint) written before apply; post-apply fingerprint proof; out-of-scope
  fingerprint guard; idempotent; reverse by manifest ids only.
- Pre-flight PASS (2B-1 app `8273a78b` + 2A-3 WS `23e94c01` live; MAIN MASTER + renderer CONTROL canonical; no
  conflict / 409 / 403; no pad under both aliases). Backup + restore test PASS (see §3).
- **Dry-run → APPLIED ~14:51Z** (workspace `31d30e23…` only), "default" → canonical: Playlist 5
  (`1f260a23`, `75b76942`, `99085b78`, `a0d1c99f`, `c9e3d568`), JinglePadAssignment 3 (`2e87dc9a` pad-birthday,
  `308291f2` pad-promo, `abaaa0d8` pad-closing), Announcement 1 (`114e5d7f`), Source 0, Schedule 0. Second apply =
  NO-OP. All row ids preserved; content fingerprints identical (only branchId / updatedAt changed); no unrelated
  row changed (identity tables + PlaybackIncident telemetry untouched).
- **Result: Playlist 6, JinglePadAssignment 4, Announcement 1 — all canonical; Source 0; Schedule 0; zero intended
  content rows on "default"; no duplicate pads** (pad-birthday, pad-bread, pad-closing, pad-promo).
- **Runtime — server-log / DB corroborated:** full VONO restart 14:55:28Z → MAIN `dsk-cbeb93d0` **MASTER** 14:55:37Z
  (`stationBranchMatchesRoom: true`), renderer **CONTROL** 14:55:40Z, both in `ws:31d30e23…:90d2b7b8…`; no 403 /
  409 / branch_conflict / error lines (app + WS); no content recreated on "default".
- **ACCEPTED — owner-attested 2026-10-06:** VONO opened normally; MASTER correct; LOCAL resumed and playing; all
  pads and playlists visible; jingles / On-Air work; no visible error.
- **Rollback not required. PROD untouched.**

### CONTROL ROOM GATE 2B-1 — CONTENT BRANCH COMPATIBILITY — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`9e06f40`** (APP only; no DB migration, no desktop, no WS server, no playback change): legacy "default" ≡
  workspace canonical branch (same-workspace alias only) for content.
  - Jingle pads (`app/api/jingles/pads/route.ts` + `lib/jingle-pad-compat.ts`): read from either alias; update the
    row that already represents the pad (no duplicate); new pads canonical; a pad under BOTH aliases = conflict
    (GET reports `conflicts`, POST 409; never guessed); concurrent first-create race handled.
  - Canonical writes at the store layer: playlists (`lib/playlist-store.ts`, null stays null; covers AI build /
    generation), sources (`lib/store.ts addSource`), radio (`lib/radio-store.ts`, canonicalized before the Branch
    upsert → no stub for the migrated workspace), jingle library.
  - `lib/playlist-access.ts` zero-assignment fallback = {default + canonical} only.
  - `lib/schedule-target-validator.ts` alias-aware for SOURCE / PLAYLIST / RADIO (caller workspace).
  - `lib/broadcast-library-updated.ts`: a canonical branch is sent to the WS as its legacy key ("default") so existing
    clients (registered with "default") still receive LIBRARY_UPDATED — no WS change.
  - Tests: `scripts/verify-gate2b1-content-compat.ts` 36/36 (real helpers / pad flows / notification over an
    in-memory fake DB) + full regression matrix (17 suites); the 2A-1 content-route guard was updated to the
    documented 2B-1 rule. Typecheck + `next build` PASS.
- TEST app deployment `8273a78b` (hash-verified). After deploy, before owner activity: Playlist 5 / Pads 3 /
  Announcement 1 all still "default".
- **Runtime — DB / server-log corroborated:** VONO reopen 14:21:17Z → MAIN MASTER + renderer CONTROL in the
  canonical room 14:21:47Z. Legacy rows untouched (3 pads, 5 playlists, 1 announcement — timestamps unchanged).
  New pad `pad-bread` (`e43d1bc7…`, 14:24:58Z) = **canonical**; new playlist **"YCD3"** (`a623406d…`, 14:26:00Z) =
  **canonical**. No pad under both aliases (no duplicate). No 409 / 403 / conflict / error lines. Three jingles
  generated (audio files only); none saved to the jingle library, so no new Announcement row.
- **ACCEPTED — owner-attested 2026-10-06:** VONO reopened with the new hosted renderer; 3 legacy pads + 5 legacy
  playlists visible; Bread pad and YCD3 still visible after a full VONO reopen (mixed legacy + canonical reads);
  On-Air works.
- NOT PROVEN by runtime: LIBRARY_UPDATED delivery (the WS does not log it) — proven by test/code only.
- Current TEST content state (intentionally mixed until Gate 2B-2): Playlist 5 "default" + 1 canonical;
  JinglePadAssignment 3 "default" + 1 canonical; Announcement 1 "default".
- **PROD untouched.**

### CONTROL ROOM GATE 2A-3 — CANONICAL WS ROOM ACTIVATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`384df45`** (SERVER / WS only: `server/branch-alias.ts`, `server/index.ts`, `server/ws-token.ts` + tests):
  alias mode ACTIVE (code constant); raw `"default"` resolves to the canonical branch for ROOM routing (device +
  controller REGISTER, owner COMMAND target, internal designation sync); connections keep the raw branchId
  (client messages / content unchanged); boot re-key BEFORE listen of designation / tombstone / lease keys
  `ws:<ws>:default` → `ws:<ws>:<canonical>` with the same values (fail safe on conflict: workspace stays on raw
  room); an active alias cannot be changed at runtime (409). `stationBranchId` read for evidence logging only.
  No playback / renderer / desktop / app / content change. Tests: `server/verify-gate2a3-activation.ts` 34/34
  (real-process boot re-key) + full regression matrix (16 suites); Gate 1 / 2A-1 static asserts updated from
  "shadow" to the documented 2A-3 behavior.
- Pre-flight PASS (backups + WS files byte-identical to the Gate 2A backup, identity canonical, Lenovo MASTER in
  `:default`). One content difference found and explained: owner-created `pad-birthday` (10:58:12Z, owner-confirmed),
  left on "default" for Gate 2B.
- **WS deploy `23e94c01` (one controlled restart, Lenovo untouched) — server-log corroborated:** boot re-key
  `rekeyed` + persisted 11:37:49Z before listen; workspace active. MAIN `dsk-cbeb93d0` → **MASTER** ("trusted
  station") and renderer → **CONTROL** at 11:38:09Z in **`ws:31d30e23-8f4a-4bf2-a1df-c707b69b5673:90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2`**;
  persisted designation + lease = canonical room → Lenovo, **zero `:default` keys**; alias file unchanged.
- **`stationBranchId` — PROVEN BY RUNTIME** (first runtime use): station REGISTER carries
  `stationBranchId=90d2b7b8…`, `stationBranchMatchesRoom: true`. **`stationDeviceId` preserved** (trusted-station MASTER).
- Resilience (each server-log corroborated: MAIN MASTER + renderer CONTROL in the canonical room, no `:default`
  MASTER, no branch_conflict / 409 / revoke / promote / duplicate MASTER):
  - **VONO restart PASS** — close 11:46:11Z → MASTER 11:46:18Z, renderer CONTROL 11:46:20Z.
  - **Clean unattended Windows reboot PASS** — disconnect 12:07:55Z → MASTER 12:09:36Z, renderer 12:09:37Z.
  - **Internet outage / recovery PASS** — disconnect 13:01:26Z (~2 m 50 s offline, past the 90 s timeout) →
    renderer CONTROL 13:04:16Z, MAIN MASTER 13:04:25Z; automatic.
- **ACCEPTED — owner-attested 2026-10-06:** LOCAL normal, MASTER badge correct, On-Air works after activation and
  VONO restart; clean reboot: VONO autostarted via watchdog, LOCAL auto-resumed, ~10 min clean, no login/action;
  outage: **music did not stop, skip or restart; MASTER badge stayed visible throughout**.
- The heavy-load freeze self-heal event (first reboot attempt / later remote session + Claude on the Lenovo) is
  NOT a Gate 2A-3 issue — PARKED item 0c (separate audit).
- **PROD untouched.**

### CONTROL ROOM GATE 2A-2 — IDENTITY DATA MIGRATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Script **`scripts/control-room/migrate-identity-2a2.mjs`** (commit `c54c8b2`; exact file executed on TEST,
  sha256 `8e930499…a256`): dry-run / apply / reverse, explicit workspace + canonical args, exact expected counts,
  collision checks, exact-id updates in one transaction, manifest written before apply, idempotent.
- Preconditions re-confirmed immediately before apply: canonical Branch `90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2`
  (T001, `legacyKey="default"`) exists; counts 1/2/1; no target collisions; WS alias SHADOW, effective `:default`;
  WS state files byte-identical to the Gate 2A backup; Lenovo MASTER in `:default`.
- **Dry-run PASS** → **APPLIED ~10:52Z** (workspace `31d30e23…` only), "default" → canonical:
  - BranchMasterDesignation ×1 (`36880080-6638-4a48-9ee6-4b9a77a50523`, Lenovo `dsk-cbeb93d0`)
  - StationDevice ×2 (`1d8e7c6d-6968-42b2-97cc-d6d9ed2b07da` Lenovo `dsk-cbeb93d0`; `20f2cf18-b0ca-4d07-9368-bea0d135f685` Dev-PC `dsk-9b11bfa1`)
  - UserBranchAssignment ×1 (`a3924506-7872-43c4-a7de-6e9fdd98b281`)
  - Second apply = NO-OP (idempotent).
- **Content rows NOT migrated** (still on "default", unchanged: Playlist 5, JinglePadAssignment 2,
  Announcement 1, Source 0) — Gate 2B.
- **Manifest** (reverse source): TEST app volume `/data/control-room/gate2a2-manifest.json` + local copy
  `D:\SyncBiz_Backups\test-env\20261006T100051Z-gate2a\gate2a2-manifest.json`, sha256
  `b3e750bdafb294475fe616908ccacacd818b68b00d8a69ab69704eff7d5e48c6`. Reverse:
  `--reverse --manifest=<path>` (canonical → "default", exact ids).
- **WS NOT restarted; effective room still `ws:31d30e23…:default`**; WS state files unchanged.
- **Compatibility rule PROVEN BY RUNTIME** (Lenovo VONO restart after migration, server-log/DB corroborated):
  MAIN closed 11:07:52Z → **MASTER** 11:08:12Z ("permanent designation -> MASTER (trusted station)") in `:default`;
  renderer **CONTROL** 11:08:15Z in `:default`; Lenovo StationDevice refreshed 11:08:13.899Z with `branchId`
  still canonical (stored row not moved; pre-2A-1 code would have returned branch_conflict). **No
  branch_conflict, no 409, no error lines.** `stationDeviceId` preserved (trusted-station MASTER requires it).
- **ACCEPTED — owner-attested 2026-10-06:** auto reopen without login PASS; MASTER badge PASS; LOCAL resumed
  automatically PASS; On-Air announcement (PLAY_INTERRUPT) PASS; nothing looked wrong.
- **Rollback not required. PROD untouched.**
- `stationBranchId` remains **PROVEN BY CODE / TEST ONLY**; its first runtime use is Gate 2A-3.
- Cosmetic, not a blocker: StationDevice `lastSeenAt` is `@updatedAt`, so the migration bumped the Dev-PC row
  to 10:52:33Z.

### CONTROL ROOM GATE 2A-1 — IDENTITY COMPATIBILITY — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`2466820`** (SERVER / app API only): legacy `"default"` ≡ the workspace's canonical branch
  (same-workspace alias only) for StationDevice binding and branch-authorization comparisons; the stored
  StationDevice row is never moved; real branch/workspace conflicts unchanged; desktop token gains additive
  signed `stationBranchId` (only together with `stationDeviceId`). WS server untouched; content resolver and
  WS alias remain **shadow**; no Playlist / Jingle / Announcement / Source / schedule change; no protected
  playback file changed. Test `scripts/verify-gate2a-identity-compat.ts` 25/25 + full regression matrix + build.
- TEST app deployment `b6050fc1` (hash-verified). Backup verified + restore test PASS (see §3).
- **Server-log corroborated** (Lenovo VONO restart after deploy): MAIN `dsk-cbeb93d0` closed 10:26:57Z →
  **MASTER** 10:27:17Z ("permanent designation -> MASTER (trusted station)"), renderer `ba8ffdba` **CONTROL**
  10:27:17Z, both in `ws:31d30e23…:default`; renderer bind (`devices-register`, `ws-token`) ran on the new code
  at 10:27:20Z; **no 409 / no branch_conflict / no error** lines since deploy.
- **`stationDeviceId` preserved — PROVEN BY RUNTIME** (trusted-station MASTER requires the token's station binding).
- **`stationBranchId` — PROVEN BY CODE / TEST ONLY** at this stage (not logged; not consumed until 2A-3).
- **ACCEPTED — owner-attested 2026-10-06:** MASTER badge PASS; LOCAL resumed automatically PASS;
  On-Air (PLAY_INTERRUPT) PASS; nothing looked wrong.
- **PROD untouched.**
- **KNOWN CAVEAT (expected):** the alias-equivalence path is NOT exercised by runtime until the StationDevice
  row moves to the canonical branch in Gate 2A-2 (pre-migration the row is still `"default"`, so no conflict
  was possible). **First mandatory acceptance check after the 2A-2 migration:** Lenovo VONO restart →
  MAIN still MASTER, renderer CONTROL, `stationDeviceId` present, no 409 / branch_conflict.

### CONTROL ROOM PHASE 1 — GATE 1 — FULL PASS / ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commits: `cea1585` (Gate 1 shadow: `Branch.legacyKey`, app resolver + WS alias map, mode = code constant
  "shadow"), `c3a14aa` (docs: TEST workspace id), **`6b5b9a0` (renderer zero-touch WS reconnect — isolated,
  cherry-pickable; preserved at local branch `fix/renderer-zero-touch-ws-reconnect`)**.
- **Server-log corroborated:** shadow resolves raw `default` → candidate `90d2b7b8…` with **effective `default`**,
  room `ws:31d30e23…:default` (no routing change); designation / lease / alias survive WS redeploy with no
  re-assertion; after a WS restart with nobody touching the Lenovo, MAIN `dsk-cbeb93d0` → MASTER (08:38:27.707
  UTC) and renderer `ba8ffdba` → CONTROL (08:38:28.044 UTC) in the same `:default` room; a TEST CONTROL saw
  MASTER + CONTROL online and its PLAY_INTERRUPT was delivered with no error.
- **ACCEPTED — owner-attested 2026-10-06:** renderer reconnect fix (automatic, no focus/interaction);
  PLAY_INTERRUPT from TEST CONTROL heard (duck → announcement → music resumed); LOCAL playback stable throughout.

### MASTER / CONTROL USER-FACING STATUS — ACCEPTED — owner-attested 2026-10-06
- Commit **`284ff66`** (renderer/display only, `feature/control-room-phase1`, pushed): the designated station
  shows GREEN "MASTER · Playing store audio" (from the existing `canLocalExec`, exposed read-only as
  `isDesignatedAudioStation`); never CONTROL / Standalone there; other devices unchanged (blue CONTROL).
  TEST deploy `5116757e-04a9-4f75-9fe5-77c408c051b8` (changed files file-hash verified).
- Owner-attested on the Lenovo: header GREEN MASTER, "Playing store audio" visible, music continues normally.
- **Server-log corroborated:** after the reload the renderer `ba8ffdba` still registers **CONTROL**
  ("embedded renderer -> CONTROL") and MAIN `dsk-cbeb93d0` **MASTER** ("permanent designation") — the
  internal WS roles are unchanged.

### JINGLES / ANNOUNCEMENTS — ACCEPTED — owner-attested 2026-10-05 (Lenovo beta.10 + TEST renderer `cd4c631`)
- Announcement Generate works in TEST.
- Generated MP3 is persisted on the Railway volume.
- On-Air from CONTROL reaches the designated Lenovo MASTER.
- Music ducks.
- Announcement plays.
- Music resumes automatically.
- LOCAL queue/session remains intact.
- Preview cannot broadcast accidentally.

### JINGLES — independently verified by Claude (TEST server, 2026-10-06)
- One TEST generate via the real API (owner-signed-in throwaway profile): HTTP 200, `audio/mpeg`, valid
  MP3 (35,152 B); file present at `/data/jingles/91361cb7-e1cf-48e4-8db8-6d542d34f516.mp3`; survived a
  container restart (PID 1 restarted after the file was written) and the later `b591c130` redeploy.

### PLAYER PHASE — ACCEPTED — owner-attested 2026-10-05 (beta.9 + renderer `2ebdbe4`, still in force)
1. LOCAL normal playback works.
2. AUTOMIX natural LOCAL → LOCAL works.
3. Manual NEXT LOCAL → LOCAL crossfade works.
4. SEEK works.
5. Watchdog: closing VONO causes it to return automatically.
6. Windows reboot WITH internet: VONO returns and playback resumes.
7. Windows cold boot WITHOUT internet: VONO starts automatically and LOCAL playback resumes
   automatically without user action.
8. Internet returns after offline cold boot: playback continues smoothly — no stop, restart or track jump.
9. Heavy system load: no deck clear, no permanent stop; playback continued.

### Earlier acceptance still in force (2026-10-05, beta.8 + `bfd3a49` — see §13)
URL playback, LOCAL ↔ URL handoffs, metadata handoff, localSync flood fix, MAIN WS auto-reconnect,
no reconnect-paced skips / false EOF / stop / restart, URL control after reconnect — owner-attested;
designated MASTER re-registration + renderer CONTROL + no auto-failover — server-log corroborated.

## 8. ROOT CAUSES FIXED

### P0 PLAYBACK HARDENING — FIXED + runtime accepted (owner-attested 2026-10-07) — details in `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md`
- **Wrong URL item / LOCAL contamination** (`e78e8a0`): PLAY_SOURCE sent without the item's trackIndex (→ 0); on the
  designated station URL-session NEXT/PREV ran against the local queue. Fixed: index passed; `transportRunsLocally()`
  routing; URL NEXT/PREV = PLAY_SOURCE N±1.
- **Watchdog vs slow URL resolution** (`2e5b4b8`): WS loads reused attemptId 0 → resolving URL judged stalled after
  ~13 s → kill/restart. Fixed: fresh MAIN attemptId per WS load; shared stall predicate for state + kill abort;
  120 s startup hard max; kill cancellation on recovered health; source-aware standby windows (LOCAL 12 s / stream
  30 s / yt-dlp 90 s).
- **Crossfade before the incoming URL was audible** (`dc74457`): ramp started on "playing + duration known". Fixed:
  stream incoming requires real time-pos progress ∧ ¬coreIdle ∧ ¬pausedForCache; promotion re-asserts volume +
  pause=false; global MPV status semantics unchanged.

### JINGLES / ANNOUNCEMENTS — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Generate failed on TEST:** `ELEVENLABS_API_KEY` missing on `syncbiz-app-test` (route returned 503
  before any TTS) → configured by the owner. No persistent app volume (files lost on redeploy) → `/data`
  volume attached; files now under `/data/jingles`.
- **On-Air never reached the designated station:** since PR #50 the branch MASTER is Electron MAIN, and
  MAIN's `routeToOrchestrator` dropped `PLAY_INTERRUPT` (`default: break`). **Fix (`cd4c631`, desktop
  MAIN → beta.10):** additive `case "PLAY_INTERRUPT"` → `interruptUrlsForPayload` / `resolveInterruptUrl`
  (relative server paths resolve against the configured app origin; https kept; local / UNC / `file:` /
  `local://` / other schemes rejected; optional pre-roll bell) → existing `orchestrator.playInterrupt`
  (duck → play once → restore). No orchestrator / music channel / session / designation change.
- **Desktop "Preview" was actually On-Air:** **Fix (`cd4c631`, renderer):** Preview separated from
  On-Air. Browser/mobile Preview is local-only (unchanged). In the Electron app (Chromium audio muted)
  Preview is disabled/unavailable with a clear tooltip instead of broadcasting. On-Air is an explicit
  separate `📡 On-Air` button that routes to the designated MASTER.

### OFFLINE COLD BOOT — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** hosted renderer unavailable offline → renderer-owned restore never ran; MAIN station WS
  depended on the renderer; dead Retry.
- **Fix (`865ba81`):** same-origin last-known-good renderer cache + MAIN WS startup connect + Retry fix.

### STALL / SESSION DESTRUCTION — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** LOCAL 4-second startup backstop called `stop()` → destroyed source/playlist/queue + recovery snapshot.
- **Fix (`2ebdbe4`):** backstop enters the existing bounded startup recovery instead of `stop()`.

## 9. PARKED / NON-BLOCKING

Not pilot blockers. Do not fix inside unrelated work.
0. ~~User-facing MASTER/CONTROL badge~~ — **RESOLVED 2026-10-06** (commit `284ff66`, see §7). Branch
   code/name in the badge still deferred to the canonical-branch work (Gate 2 / Control Room).
0b. **BLOCKER BEFORE A SECOND TEST BRANCH (pre-multi-branch):** the embedded renderer still activates with
   branch `"default"` from MAIN's config; its branch must come from its co-located trusted Station/MAIN
   binding. Separate audited fix — NOT part of Gate 2A.
0c. **PLAYBACK HARDENING — freeze self-heal REDISPATCH (recorded 2026-10-06, separate audit/approval required).**
   Observed during the first Gate 2A-3 Windows-reboot test on the Lenovo. Classification from the Lenovo-local
   audit (owner-provided; this Dev-PC session did not inspect the Lenovo logs): NOT caused by Gate 2A-3
   canonical routing; MAIN / MPV / renderer did not crash or reload; session/queue preserved; the earlier
   destructive startup-stall bug did NOT recur; the event was the existing bounded freeze self-heal reacting to
   a system-wide stall (Claude was opened shortly before the stall — causation NOT proven). Two issues:
   1. freeze REDISPATCH reloads the same LOCAL track from position 0 (loses the playback position);
   2. the freeze timer is not reset on PLAYING_CONFIRMED, which allows a redundant REDISPATCH.
   **Do NOT implement during Gate 2A-3.** Needs its own AUDIT → root cause → approval. Protected playback
   baseline stays unchanged until then. The Gate 2A-3 reboot test is repeated as a CLEAN unattended test
   (no Claude, no extra apps, no interaction, wait 2–3 min after LOCAL starts).
1. **Jingle schedules are still localStorage-only** (`components/jingles-control/schedule-storage.ts` +
   `JingleScheduleAutoPlayer`): each device fires only its own schedules while that client is open.
   **Must move to a central/server-side model during Control Room.**
2. **Multi-branch broadcast not implemented yet** (server fan-out to several rooms + delivery/ack).
3. **Mobile TEST login/user issue** — separate authentication/control task.
4. **Playback recovery snapshot 24-hour TTL — REAL PILOT FOLLOW-UP.** `RECOVERY_TTL_MS` (24h) in
   `lib/playback-provider.tsx`: a station powered off >24h may not auto-resume. Record only.
5. **Explicit kill-`mpv.exe` resilience test** — manual destructive test not yet run (code path regression-tested).
6. **Missing/corrupt LOCAL file runtime acceptance** — manual test not yet run (code path regression-tested).
7. **STARTUP QUEUE HYDRATION (UI / session restore — NON-P0, recorded 2026-10-06, re-observed 2026-10-07 after F1).**
   After a VONO cold start / reopen: LOCAL audio resumes correctly and the current track plays correctly, but the
   visible playlist / queue can stay empty and NEXT is unavailable at first; after the first natural track transition
   the full LOCAL queue appears and NEXT works. **Desired:** startup restore hydrates the visible queue / session
   immediately, **without restarting or redispatching the currently playing track.** NOT a playback-continuity P0;
   not caused by F1. Own audit / gate; do NOT change playback for it now.
8. **ACTIVE PLAYLIST VISUAL INDICATOR (UI, recorded 2026-10-06).** The UI previously showed which playlist was
   actively playing (especially URL playlists) with an animated LED / snake-style border around the playlist
   artwork. Owner wants an obvious "currently playing playlist" indication restored later. Not a pilot blocker.
   Separate audit later; no UI redesign now.
9. **Branch stub creation (found in the Gate 2B audit, 2026-10-06).** `lib/store.ts` (addSchedule / addDevice) and
   `lib/radio-store.ts` upsert a Branch row whose **id** is the raw branch key (e.g. id `"default"`, `update: {}`);
   Branch.id is global, so a second workspace would link to the first workspace's stub. Not present in TEST
   (0 Schedule / Device rows; radio now canonicalizes first). Separate audit; not part of Gate 2B.
10. **Generic `/api/announcements` POST (found in Gate 2B-1).** Unauthenticated, stores `workspaceId: "system"`,
   so its branch cannot be canonicalized safely; left unchanged in 2B-1. Jingle announcements use the
   authenticated `/api/jingles/library` (canonical). Separate audit.
11. **GATE 3B SECURITY-HARDENING ITEMS (authorization audit 2026-10-06; recorded in Gate 3A, NOT fixed).** All
   PROVEN BY CODE; present in the shared code (PROD has the same code paths). Each a separate audited fix in 3B:
   a. ~~**Schedule cross-workspace IDOR**~~ — **FIXED in Gate 3B-2 (`cdebde5`, TEST)**. Was: `schedules/[id]` looked
      up by global id; workspace mismatch only logged; any workspace OWNER passed via `"*"`.
   b. ~~**Primary-workspace drift**~~ — **FIXED in Gate 3B-1 (`23ff679`, TEST)**. Was: `hasBranchAccess` /
      `getAssignedBranchIdsForUser` / `requireAdmin` / `isOwner` resolved the user's PRIMARY workspace;
      `getTenantRole` fell back to the primary membership.
   c. ~~**Bearer token workspace drift**~~ — **FIXED in Gate 3B-1 (`23ff679`, TEST)**. Was: `getCurrentUserFromApiRequest`
      dropped the token's signed workspace.
   d. **Unauthenticated mutating routes** — PARTIALLY FIXED. ~~`player/commands`, `play-now`, `commands/play-local`,
      `commands/stop-local`, `agent/commands`~~ → **retired to 410 in Gate 3B-4a (`2cb46d2`, TEST)**. Still open (per
      the 3B-4 audit split): `announcements` GET/POST (3B-4b), `logs` (3B-4c), metadata / proxy routes incl. SSRF on
      `radio/metadata` + `sources/parse-url` and anonymous yt-dlp (3B-4d). `jingles/audio/[id]` + `jingles/bell/*`
      must stay URL-playable for MAIN On-Air.
   e. ~~**MANAGER → OWNER escalation**~~ — **FIXED in Gate 3B-3 (`c5ddf8b`, TEST)**, together with the cross-workspace
      global-password takeover and tenant global-disable takeover found in its audit. Was: `admin/users` POST/PATCH
      accepted `accessType:"OWNER"` with no caller-rank check (MANAGER passed `requireAdmin`).
   f. **Client-chosen `owner_global`** — WS REGISTER accepts any role from the client (`server/index.ts:686`).
   g. **WS COMMAND capability bypass** — no role/capability check on COMMAND (`server/index.ts:1532-1573`); MAIN
      executes any relayed command; non-designated branches allow browser MASTER election.
   h. **Workspace-wide announcements** — GET returns all workspaces; POST writes workspace `"system"`.
   i. **Guest session-code scope** — session codes are not workspace-scoped.
12. **FULLSCREEN MODALS (UI, recorded 2026-10-06; owner-observed on the Lenovo).** In fullscreen mode the Jingles
   "Add to Pad" and "Schedule" dialogs are not visible; outside fullscreen both work normally, and On-Air works.
   Classified as a fullscreen modal / UI visibility issue only — NOT a jingle backend or playback issue; unrelated
   to Gate 3A. Non-blocking; fix in the later UI gate. (HYPOTHESIS, not proven: may explain the Gate 3A shadow
   review observation that a pad edit produced no server-side pad save.)
13. **EXISTING-USER WORKSPACE INVITE HAS NO ACCEPTANCE / CONSENT FLOW (security / product, recorded 2026-10-06 in
   Gate 3B-3).** `POST /api/admin/users` with an existing user's email adds that user to the caller's workspace
   immediately (`inviteExistingUserToWorkspace`), with no acceptance step. The account-takeover chains that used this
   are CLOSED in Gate 3B-3 (a workspace admin can no longer overwrite another user's global password, an invite never
   sets/changes an existing user's password, and global disable is platform SUPER_ADMIN only), but unsolicited
   membership itself remains. Needs a product decision (invite / accept flow); not redesigned in 3B-3.
14. **EXCESSIVE SCHEDULES POLLING (performance, recorded 2026-10-06 during Gate 3B-4a runtime review).** TEST HTTP logs
   show ~1,549 `GET /api/schedules` requests in ~9 minutes (19:38:44Z → 19:47:34Z; ~3 requests / second) — far above
   what a schedule check needs. NOT a Gate 3B-4a regression; not investigated or changed. Later audit should determine:
   exact caller(s); whether multiple renderers / components poll independently; the intended polling interval;
   duplicate timers / effects; the effect at 300-station scale; whether push / event-driven refresh can replace it.

15. **URL STARTUP LATENCY (performance — PARKED 2026-10-07 at the P0 lock).** Owner-observed ~15–76 s from command to
   audio for some yt-dlp URLs on the Lenovo (beta.12). Continuity is protected (outgoing audio continues; no watchdog
   restart; no force kill), so this is a PERFORMANCE item, not a playback-continuity P0. Own audit/gate; not part of
   the baseline-lock commit.
16. ~~**URL NATURAL EOF AUTO-ADVANCE**~~ — **FIXED 2026-10-07** (`8e8895a`, runtime accepted; see §7).
17. **EXTERNAL CONTROLLER OWNERSHIP RELEASE (playback, PARKED 2026-10-07).** Another controller switching MAIN to a
   source does not release the Lenovo renderer's session ownership. Own gate.
18. **yt-dlp `_MEI*` TEMP CLEANUP (desktop hygiene, PARKED 2026-10-07).** Leftover PyInstaller extraction folders from
   yt-dlp runs. Own gate.
19. **MAIN engine failure with mock status "playing" (watchdog residual, recorded 2026-10-07).** Recovery then relies
   on the 120 s startup hard max instead of the 12 s stall rule. Record only.

20. **WATCHDOG MANUAL-LAUNCH RACE (Protection, NON-P0, recorded 2026-10-07).** After an intentional stop followed by a
   manual launch, the watchdog may briefly issue a redundant launch because it still sees the old PID; single-instance
   protection currently absorbs it (no duplicate player observed). Own audit; do NOT fix now.

21. **PREMATURE LONG-URL EOF (playback, PARKED 2026-10-07).** Long (~2 h) YouTube URLs reached `MPV_ENDFILE reason=eof`
   at ~14 min (r7, r8). Since `8e8895a` the session advances instead of going silent, but the premature termination
   itself is UNEXPLAINED. Own audit / gate (evidence first).
22. **STARTUP SOURCE RESTORE / SETTINGS COHERENCE (playback, PARKED 2026-10-07).** VONO startup always resumes LOCAL even
   when URL / YouTube was the last active source; a renderer reload / navigation to Settings can start stale LOCAL while
   MAIN still reports URL. Desired: startup / reload restores the actual active source / session (not blindly LOCAL);
   no UI / audio source mismatch. Own audit / gate.

Carried over (still open):
- Jingle library/pads still use `branchId:"default"`; no link to `MediaAsset`; generated-but-unsaved MP3s
  are never cleaned up; `/api/jingles/audio/<id>` is unauthenticated (UUID-only).
- Desktop app has no local Preview engine yet (Preview unavailable there by design for now).
- Temporary `[VONO MetaSync]` `console.warn` diagnostics — still present in `lib/device-player-context.tsx`.
- `[VONO Shuffle Diag]` `console.log` — still present in `components/audio-player.tsx` (~4395).
- Git stash `pr52-xfade-diag-hold` (`stash@{0}`) — still present; diagnostic only.
- Long-outage / token-expiry endurance test — not yet run.
- ~~URL startup latency (~10–13 s on Lenovo)~~ — superseded by §9 item 15 (observed 15–76 s, 2026-10-07).
- Reconnect: CONTROL LOCAL title display blank — addressed in `9264bb3`; **NOT runtime-confirmed**.
- Offline cache edge: a TEST deploy during an outage may break lazily-loaded UI pieces until restart.
- Offline station cannot play hosted jingle MP3s (no local jingle cache yet).
- SECURITY TODO: a Railway token is stored in plaintext in `.claude/settings.local.json`
  (gitignored, not committed) — rotate the token and remove it, separately.
- Pre-existing desktop `tsconfig.typecheck.json` errors (not the packaging path) — known, untouched.

## 10. DO NOT REGRESS

*(added 2026-10-07, P0 URL continuity + ownership — renderer `d617314`)*
- URL session natural EOF → exactly one auto-advance to the next URL (no wrap at the last item, no duplicate load)
- while MAIN plays a URL session, LOCAL autonomous transitions (AUTOMIX / NEXT / PLAY_REQUEST / crossfade / load) are inert
- explicit URL → LOCAL switch, LOCAL-only AUTOMIX and manual LOCAL NEXT unchanged

*(added 2026-10-07, P0 playback hardening — beta.12)*
- URL trackIndex correct (no wrong first item); URL NEXT/PREV coherent; no LOCAL contamination of a URL session
- fresh MAIN attemptId per WS load; watchdog never restarts a slow-resolving URL (startup hard max 120 s); kill
  cancelled when health returns
- source-aware standby windows (LOCAL 12 s / stream 30 s / yt-dlp 90 s) — timeout keeps the current track
- stream crossfade only after real MPV progress (¬coreIdle, ¬pausedForCache); outgoing deck audible while buffering
- promoted deck volume + pause normalized; LOCAL→LOCAL crossfade fast path unchanged

- permanent designated MASTER (MAIN = MASTER, renderer = CONTROL; no failover, no steal)
- LOCAL playback
- URL playback
- LOCAL -> URL
- URL -> LOCAL
- NEXT
- PREV
- SEEK
- metadata handoff
- localSync idempotency / no flood
- natural EOF
- manual crossfade
- AUTOMIX natural crossfade
- reconnect while LOCAL plays
- no reconnect skips
- no reconnect stop/restart
- watchdog recovery
- restart WITH internet
- cold boot WITHOUT internet → LOCAL auto-resume (offline renderer cache)
- internet return after offline boot → no reload / stop / restart / jump
- heavy system load → no deck clear, no permanent stop (stall backstop never calls stop())
- **On-Air jingle from any CONTROL → designated MAIN: duck → play → resume; LOCAL queue/session intact**
- **Preview never emits PLAY_INTERRUPT (browser/mobile local; desktop Preview unavailable)**
- **jingle MP3s persisted on the TEST `/data` volume**
- renderer CONTROL + MAIN MASTER architecture
- no local file paths over WS/HTTP/server/DB/logs (PLAY_INTERRUPT rejects local paths)

## 11. LAST ACCEPTANCE

- **Date:** 2026-10-07 — **P0 PLAYBACK HARDENING** — Desktop 2.2.8-beta.12 (SHA256 `3becd1c8…9429`) + TEST renderer
  `3d6a70d` (deployment `a1028a7f`). **OWNER-ATTESTED** on the Lenovo (§7). Result: ACCEPTED; baseline locked
  (tags in §12). Previous acceptance below.

- **Date:** 2026-10-05
- **Build under test:** Desktop 2.2.8-beta.10 (TEST-pinned, SHA256 `0e292ec1…f9b0`) + TEST renderer `cd4c631`.
- **OWNER-ATTESTED:** §7 jingles list — Generate in TEST, MP3 persisted, On-Air from CONTROL reaches the
  designated Lenovo MASTER, music ducks, announcement plays, music resumes, LOCAL queue/session intact,
  Preview cannot broadcast.
- **CLAUDE-VERIFIED (TEST server):** one real generate → MP3 on `/data/jingles`, survives restart/redeploy.
- **Result:** JINGLES / ANNOUNCEMENTS — PILOT ACCEPTED (player phase acceptance remains in force).

## 12. ROLLBACK

| Layer | Reference |
|---|---|
| **Renderer / playback baseline (2026-10-07, CURRENT)** | tag `pilot-baseline/2026-10-07-renderer-d617314` → `d61731471cc9a8a52965c417a0a3898495b721e8`; TEST deployment `3f258faf` (renderer only — Desktop installer unchanged, beta.12) |
| **Control Room F2a (2026-10-07)** | tag `pilot-baseline/2026-10-07-control-room-f2a-398cce7` → `398cce77662ad4d5fda79c7738556b6620a660f1`; app deployment `54f898f9`; DB backup `D:\SyncBiz_Backups\test-env\20261007T104212Z-control-room-f2a\` (or drop MemberScopeTarget + MemberScope) |
| **Control Room F1 (2026-10-07)** | tag `pilot-baseline/2026-10-07-control-room-f1-25d4c06` → `25d4c0685517f235df69fac3fb89c555807ef698`; app deployment `538902e8`; DB backup `D:\SyncBiz_Backups\test-env\20261007T094829Z-control-room-f1\` (or drop the additive F1 objects) |
| **CURRENT desktop baseline tag (2026-10-07)** | `pilot-baseline/2026-10-07-desktop-beta12-dc74457` → `dc744575e97279358e6794687ed37d408706677d` |
| **CURRENT renderer baseline tag (2026-10-07)** | `pilot-baseline/2026-10-07-renderer-3d6a70d` → `3d6a70de92e54e88ba00e2f7f14dc6589e5cf644`; TEST deployment `a1028a7f-98f2-4a5f-9a82-fb47f35f03f7` |
| **CURRENT accepted installer** | `D:\SyncBiz_Backups\pilot\2026-10-07-beta12-p0-accepted\SyncBiz-Player-Setup-2.2.8-beta.12-x64.exe`, SHA256 `3becd1c881c6c847f11c0c10f2f1549c7987be92bb1e83808b36cf8528e49429` |
| **Accepted renderer tag** (previous, jingles) | `pilot-baseline/2026-10-05-renderer-cd4c631` → `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| **Accepted desktop source-lineage tag** | `pilot-baseline/2026-10-05-desktop-beta10-cd4c631` → `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| **Accepted installer artifact** | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-accepted\SyncBiz-Player-Setup-2.2.8-beta.10-x64.exe`, SHA256 `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| Railway TEST deployment | `b591c130-4112-433a-a928-6f0f424a5dce` (may become non-redeployable once REMOVED — the tag is the fallback) |
| Older rollback (preserved) | player phase: tags `pilot-baseline/2026-10-05-renderer-2ebdbe4`, `pilot-baseline/2026-10-05-desktop-beta9-865ba81`; artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\` (SHA256 `72744069…6dc58`). Pre-offline: tags `…renderer-bfd3a49`, `…desktop-beta8-9264bb3`; artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (SHA256 `349152a9…583ff`) |

All `pilot-baseline/*` tags are annotated and pushed to origin (owner-approved). Never use the
`desktop-v*` prefix (triggers the release workflow).

**WARNING:** desktop source tags do NOT reproduce beta.8/beta.9/beta.10 exactly by themselves — all used
temporary TEST-pin edits. Restore the Lenovo from the preserved installer binary, verified by hash.
Rolling the renderer back below `cd4c631` while beta.10 is installed is safe (MAIN PLAY_INTERRUPT is
additive); rolling the desktop back to beta.9 loses MAIN On-Air jingles.

## 13. HISTORY

### Player phase acceptance (2026-10-05) — superseded as "current" by the jingles acceptance above
- Renderer application baseline `2ebdbe4b9f2945e91987b2dfb5f61719103a9adf` (LOCAL startup-stall fix);
  docs-only head `17a1b849e7005f99e51269db5a0d42689ab8acc0`.
- Desktop `2.2.8-beta.9`, source lineage `865ba81e5cb83be8493ab7374194aa1d145ea633` + temporary TEST
  pins; SHA256 `72744069ad422c45130ddf530880f7e0fdc7b8b071dfd0fbde4693357ce6dc58`, 140,768,398 bytes,
  TEST-pinned, unsigned, not published; accepted backup `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\`
  (candidate copy `…-beta9-candidate\`).
- TEST renderer deployment `673fae24-3105-4360-8c31-88d83f61705f` (image
  `sha256:c2d16ad09077de4317b7f1c25a0c948e4c28209772d7b2f05c976d08827f7fff`); deployed
  `audio-player.tsx` + `desktop-freeze-self-heal.ts` file-hash identical to `2ebdbe4`.
- Owner-attested: §7 PLAYER PHASE items 1–9. Tags `pilot-baseline/2026-10-05-renderer-2ebdbe4`,
  `pilot-baseline/2026-10-05-desktop-beta9-865ba81`.

### Baseline 2026-10-05 (pre-offline-fix)
- Application/renderer baseline `bfd3a49a056b98a7d3daa33cd7aeb6e8ec29a5bb`; docs-only head
  `044219043c76dcfeae33350124b8d7faa4930c89` (constitution + first baseline).
- Desktop `2.2.8-beta.8`, source lineage `9264bb3331c1cd3953689f6fdd32f827332420a8` + temporary
  TEST pins; SHA256 `349152a9d9caa7c81634b2850fa967f2349b0e58eabde1df73e0cc66dfa583ff`,
  140,762,736 bytes, TEST-pinned, unsigned, not published; backup `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\`.
- TEST renderer deployment `25b48cc0-03b1-48a9-a1d7-a099420eeabd` (image
  `sha256:d2a1e1ba5de3bc7ed9e0bcb61e6ef8c014ad0b3be03d0f4268af066f016c74cf`); deployed source
  verified file-hash identical to `bfd3a49` (629 source files + root config files; linkage not
  cryptographically proven).
- Owner-attested at that baseline: LOCAL, URL, LOCAL↔URL, metadata handoff, stale-session fix,
  localSync flood fix, SEEK, manual NEXT crossfade, natural AUTOMIX, MAIN WS auto-reconnect, no
  reconnect skips / false EOF / stop / restart, designated MASTER return, renderer CONTROL, URL
  control after reconnect, watchdog relaunch, reboot with internet.
- Open P0 at that time: **OFFLINE COLD BOOT** — later FIXED (§8).

### Offline cold boot fix — test candidate (2026-10-05)
- `865ba81` pushed to PR #52; beta.9 candidate built and preserved at
  `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-candidate\` (NOT accepted at that time; rollback was beta.8).
- Phase 1 proofs (real Electron 34.5.8, TEST): session fetch carries auth context; same-origin
  `protocol.handle` interception keeps origin + localStorage. E2E offline-cache proof PASS.
- Lenovo runtime then found the separate stall/session-destruction P0 → fixed in `2ebdbe4`.

### Jingles P0 — test candidate (2026-10-06)
- Audit: Generate failed on TEST (missing `ELEVENLABS_API_KEY`); no app volume; MAIN dropped
  `PLAY_INTERRUPT`; desktop Preview was On-Air; schedules localStorage-only (parked).
- TEST config: key added by the owner; `/data` volume attached; one real generate verified.
- `cd4c631` pushed; beta.10 candidate preserved at `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-candidate\`;
  then owner-accepted on the Lenovo (§7).
