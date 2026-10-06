# VONO PILOT KNOWN-GOOD BASELINE

> Operational, changeable state. Update after EVERY runtime-accepted blocker (CLAUDE.md §8).
> Permanent rules live in `CLAUDE.md`. No secrets in this file — ever.
> Evidence labels: `ACCEPTED — owner-attested <date>` (Dotan on the Lenovo; not independently
> inspected by Claude) vs `ACCEPTED — server-log corroborated` (TEST WS/server logs).
> Earlier baselines are kept verbatim-in-substance in §13 HISTORY — never delete history.

## 1. STATUS

- **Date:** 2026-10-05 (jingles acceptance recorded 2026-10-06 UTC+3 night)
- **Phase:** PILOT HARDENING
  - **PLAYER PHASE: PILOT ACCEPTED** (owner-attested 2026-10-05)
  - **JINGLES / ANNOUNCEMENTS: PILOT ACCEPTED** (owner-attested 2026-10-05)
- **Current active P0:** none. Next phase: Control Room / branch management.
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
  existing content rows still on "default". **Gate 2B-2 (content data migration) NOT started.** See §7 "GATE 2B-1".
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
| Installed Desktop | `2.2.8-beta.10` | **OWNER-ATTESTED / NOT DIRECTLY VERIFIED FROM THIS MACHINE** |
| Embedded renderer WS id | `ba8ffdba-d00b-468d-bf74-f805013d37ef` (CONTROL) | server-log corroborated (earlier sessions) |

## 5. DESKTOP INSTALLER (ACCEPTED)

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
7. **STARTUP PLAYLIST CONTENT HYDRATION (UI, recorded 2026-10-06).** On VONO startup LOCAL playback begins
   correctly, but the visible playlist / queue track stack may stay empty until the first track transition.
   Owner: NOT a pilot blocker. Separate audit later; do NOT change playback for it now.
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

Carried over (still open):
- Jingle library/pads still use `branchId:"default"`; no link to `MediaAsset`; generated-but-unsaved MP3s
  are never cleaned up; `/api/jingles/audio/<id>` is unauthenticated (UUID-only).
- Desktop app has no local Preview engine yet (Preview unavailable there by design for now).
- Temporary `[VONO MetaSync]` `console.warn` diagnostics — still present in `lib/device-player-context.tsx`.
- `[VONO Shuffle Diag]` `console.log` — still present in `components/audio-player.tsx` (~4395).
- Git stash `pr52-xfade-diag-hold` (`stash@{0}`) — still present; diagnostic only.
- Long-outage / token-expiry endurance test — not yet run.
- URL startup latency (~10–13 s on Lenovo) — owner-reported; reproducibility NOT VERIFIED.
- Reconnect: CONTROL LOCAL title display blank — addressed in `9264bb3`; **NOT runtime-confirmed**.
- Offline cache edge: a TEST deploy during an outage may break lazily-loaded UI pieces until restart.
- Offline station cannot play hosted jingle MP3s (no local jingle cache yet).
- SECURITY TODO: a Railway token is stored in plaintext in `.claude/settings.local.json`
  (gitignored, not committed) — rotate the token and remove it, separately.
- Pre-existing desktop `tsconfig.typecheck.json` errors (not the packaging path) — known, untouched.

## 10. DO NOT REGRESS

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
| **Accepted renderer tag** | `pilot-baseline/2026-10-05-renderer-cd4c631` → `cd4c631fc90570f062040def825f0c91bcff5bc3` |
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
