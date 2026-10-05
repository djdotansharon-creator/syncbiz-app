# VONO PILOT KNOWN-GOOD BASELINE

> Operational, changeable state. Update after EVERY runtime-accepted blocker (CLAUDE.md §8).
> Permanent rules live in `CLAUDE.md`. No secrets in this file — ever.
> Evidence labels: `ACCEPTED — owner-attested <date>` (Dotan on the Lenovo; not independently
> inspected by Claude) vs `ACCEPTED — server-log corroborated` (TEST WS/server logs).

## 1. STATUS

- **Date:** 2026-10-05
- **Phase:** PILOT HARDENING
- **Current active P0:** OFFLINE COLD BOOT (see §8)
- **PR #52:** OPEN — **DO NOT MERGE**
- **Written from:** Dev-PC (`dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`) — no direct Lenovo log access.

## 2. GIT

| Item | Value |
|---|---|
| Repository | `D:\APP Project\syncbiz-app` |
| Branch | `fix/local-playback-designated-master-prb` |
| PR | #52 (OPEN, MERGEABLE, not draft — verified via `gh pr view 52`) |
| **CURRENT PR HEAD** | the single **docs-only** commit `docs(pilot): lock VONO engineering rules and known-good baseline`, whose parent is `bfd3a49`. A commit cannot contain its own SHA — read it with `git rev-parse origin/fix/local-playback-designated-master-prb` (it is also reported in the session that created it). |
| **APPLICATION CODE BASELINE** | `bfd3a49a056b98a7d3daa33cd7aeb6e8ec29a5bb` — the exact application/runtime source currently accepted |
| **TEST RENDERER SOURCE BASELINE** | `bfd3a49a056b98a7d3daa33cd7aeb6e8ec29a5bb` (see §6) |
| **DESKTOP beta.8 SOURCE LINEAGE** | `9264bb3331c1cd3953689f6fdd32f827332420a8` + documented temporary TEST build edits (see §5) |
| main / PR base | `951a44cd99f39d921e217d246f6422b49cee2941` (verified after fresh fetch) |
| Working tree when written | clean at `bfd3a49` (before the docs-only commit that adds this file) |
| Stash present | `stash@{0}` = `pr52-xfade-diag-hold` (temporary diagnostic, see §9) |

Meaning: `bfd3a49` is the exact application/runtime source currently accepted. The commit above
it contains **documentation only** (`CLAUDE.md`, `docs/VONO_PILOT_BASELINE.md`) — owner-approved
one-time exception, 2026-10-05. **No application source changed after `bfd3a49`.** Verify with
`git diff --stat bfd3a49..origin/fix/local-playback-designated-master-prb`.

## 3. TEST ENVIRONMENT

| Item | Value |
|---|---|
| Railway project | `syncbiz-pr52-test` |
| Renderer (app) | https://syncbiz-app-test-production.up.railway.app (HTTP 200; `/api/health` ok) |
| WS | wss://syncbiz-ws-test-production.up.railway.app (`/health` 200) |
| Renderer Railway deployment ID | `25b48cc0-03b1-48a9-a1d7-a099420eeabd` (SUCCESS, 2026-10-05 17:53:01 +03:00) |
| Renderer image digest | `sha256:d2a1e1ba5de3bc7ed9e0bcb61e6ef8c014ad0b3be03d0f4268af066f016c74cf` |
| TEST DB | Postgres inside `syncbiz-pr52-test` (test secrets stored outside the repo — never here) |

**PROD untouched.** No PROD deploy, DB, WS or installer action in this baseline.

## 4. LENOVO PILOT STATION

| Item | Value | Evidence |
|---|---|---|
| durableDeviceId | `dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f` | server-log corroborated (TEST WS REGISTER) |
| branch | `default` | server-log corroborated |
| workspace | `f2366813-341d-46ba-a6b8-92d2c1fd39b1` | recorded in project notes; not printed in the inspected WS log lines |
| Installed Desktop | `2.2.8-beta.8` | **OWNER-ATTESTED / NOT DIRECTLY VERIFIED FROM THIS MACHINE** |
| Embedded renderer WS id | `ba8ffdba-d00b-468d-bf74-f805013d37ef` (CONTROL) | server-log corroborated |

## 5. DESKTOP INSTALLER

| Item | Value |
|---|---|
| Version | `2.2.8-beta.8` |
| Desktop logical source SHA | `9264bb3331c1cd3953689f6fdd32f827332420a8` |
| Artifact | `SyncBiz-Player-Setup-2.2.8-beta.8-x64.exe` |
| SHA256 | `349152a9d9caa7c81634b2850fa967f2349b0e58eabde1df73e0cc66dfa583ff` (re-verified 2026-10-05) |
| Size | 140,762,736 bytes |
| Environment | **TEST-pinned** |
| Signing | unsigned |
| Published | **NO** |
| Build location | `desktop/dist-installer/` (gitignored build output) |
| Preserved copy | `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (+ `SHA256.txt`, `README.txt`; copy hash verified OK) |

**Important:** beta.8 was built from `9264bb3` **plus temporary TEST endpoint/version edits**
(hosted-url → TEST app + TEST WS; runtime-config forced TEST endpoints on packaged load;
`desktop/package.json` version → 2.2.8-beta.8), **reverted after the build**. Build-time asar
check recorded: TEST app=1 / TEST ws=1 / PROD-ws-exec=0. **`9264bb3` alone cannot reproduce the
binary exactly — the artifact hash is authoritative.** Committed `hosted-url.ts` points at PROD.

## 6. RENDERER

| Item | Value |
|---|---|
| Expected deployed renderer source | `bfd3a49a056b98a7d3daa33cd7aeb6e8ec29a5bb` |
| Railway deployment ID | `25b48cc0-03b1-48a9-a1d7-a099420eeabd` |
| Deploy method | `railway up` (uploads the working tree; Railway metadata carries **no commit hash**) |

**Verification (2026-10-05, read-only, `railway ssh` into the TEST container):**
- SHA-256 of **all 629** `.ts/.tsx` source files under `app/`, `components/`, `lib/`,
  `server/index.ts`, `middleware.ts` in the deployed container = **byte-identical** to the clean
  `bfd3a49` checkout (0 mismatches). `package.json`, `package-lock.json`, `next.config.ts`,
  `prisma/schema.prisma`, `tsconfig.json` also identical.
- Discriminating file: deployed `components/audio-player.tsx` matches `bfd3a49` (`654f00bf…`)
  and **not** `9264bb3`/`198eaca` (`cdf5696f…`) → the deploy is not an older commit.
- Live public bundle marker check was not possible (player chunks sit behind login on a
  non-local host; Claude does not authenticate there).

**Confidence:** deployed SOURCE verified = `bfd3a49` (file-hash level, no uncommitted overlay in
the compared files). Exact commit-to-deploy linkage: **NOT CRYPTOGRAPHICALLY PROVEN** (no commit
hash in Railway metadata; files outside the compared set, e.g. `public/`, were not hashed; the
running `.next` build is assumed built from that source in the same image).

## 7. RUNTIME ACCEPTED

### ACCEPTED — server-log corroborated (TEST WS logs, inspected 2026-10-05)
- Same durable station `dsk-cbeb93d0…` returns after WS closes (codes 1005/1006) and is granted
  **MASTER** with reason `permanent designation -> MASTER (trusted station)`.
- Embedded renderer `ba8ffdba…` registers as **CONTROL** (`permanent designation: embedded renderer -> CONTROL`).
- No automatic re-election/failover on MASTER close (`shouldTryAutoPromote:false`,
  `masterAfter` stays the designated station; reason `dedicated MASTER ambiguous close -> grace window`).

(Server logs cannot distinguish a WS auto-reconnect from an app relaunch; those are owner-attested below.)

### ACCEPTED — owner-attested 2026-10-05 (Lenovo; not independently inspected by Claude)
- LOCAL playback works
- URL playback works
- LOCAL -> URL works
- URL -> LOCAL works
- metadata handoff works
- stale LOCAL session no longer overwrites URL session
- localSync flood fixed
- SEEK works
- manual NEXT crossfade works
- natural LOCAL -> LOCAL AUTOMIX crossfade works
- P0 MAIN WS auto-reconnect works
- no reconnect-paced local track skipping
- no false EOF caused by reconnect
- reconnect does not stop LOCAL
- reconnect does not restart LOCAL
- same durable station returns as designated MASTER (also server-log corroborated)
- renderer remains CONTROL (also server-log corroborated)
- URL control works after reconnect
- watchdog relaunch after VONO termination works
- Windows restart WITH internet brings VONO/playback back

## 8. OPEN P0 BLOCKERS

### OFFLINE COLD BOOT — ACTIVE

**Runtime observation (owner-attested):** Windows reboot WITHOUT internet → the Electron shell
starts but shows:

> "Cannot connect to SyncBiz — Could not load the SyncBiz web app."

because it attempts to load the hosted TEST renderer.

**Critical distinction:**
- Internet loss AFTER VONO is already running → LOCAL playback survives (owner-attested).
- Windows boot/reboot WITHOUT internet → LOCAL automatic restore currently **FAILS** because the
  hosted renderer cannot load at startup.

**Required target behavior:** POWER / WINDOWS REBOOT + NO INTERNET = VONO starts + station
identity/designation available locally + LOCAL playback/session restored + MPV audio resumes +
NO user action. When internet later returns: MAIN reconnects; same station remains MASTER;
renderer/cloud control recovers; current audio is not stopped/restarted.

**Status: NOT SOLVED. AUDIT REQUIRED BEFORE CODE.**

## 9. PARKED / NON-BLOCKING

Do not fix inside unrelated blocker work.
- Temporary `[VONO MetaSync]` `console.warn` diagnostics — still present in
  `lib/device-player-context.tsx` (~1140–1236). Remove after acceptance (owner-approved temporary).
- `[VONO Shuffle Diag]` `console.log` — still present in `components/audio-player.tsx` (~4385).
- Git stash `pr52-xfade-diag-hold` (`stash@{0}`) — still present; diagnostic only.
- Long-outage / token-expiry endurance test — not yet run (very long outage may outlive the WS
  token; reconnect then depends on renderer re-activation).
- URL startup latency (~10–13 s on Lenovo) — owner-reported; current reproducibility NOT VERIFIED.
- Reconnect: CONTROL LOCAL title display blank — the session reset on transport close was removed
  in `9264bb3` (`mock.reset()` now only on intentional teardown), which should address it;
  **NOT runtime-confirmed**.
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
- renderer CONTROL + MAIN MASTER architecture
- no local file paths over WS/HTTP/server/DB/logs

## 11. LAST ACCEPTANCE

- **Date:** 2026-10-05
- **Build under test:** Desktop 2.2.8-beta.8 (TEST-pinned) + TEST renderer `bfd3a49`.
- **OWNER-ATTESTED:** full §7 owner-attested list passed on the Lenovo — LOCAL/URL playback and
  both handoffs, metadata handoff, SEEK, manual NEXT + natural AUTOMIX crossfade, network outage
  with MAIN WS auto-reconnect (no skips / false EOF / stop / restart), URL control after
  reconnect, watchdog relaunch, Windows restart with internet.
- **SERVER-LOG CORROBORATED:** designated MASTER re-registration of `dsk-cbeb93d0…` after closes,
  renderer CONTROL, no auto-failover.
- **FAILED:** Windows restart WITHOUT internet (OFFLINE COLD BOOT, §8).

## 12. ROLLBACK

| Layer | Reference |
|---|---|
| Renderer/source tag | `pilot-baseline/2026-10-05-renderer-bfd3a49` → `bfd3a49a056b98a7d3daa33cd7aeb6e8ec29a5bb` |
| Desktop source-lineage tag | `pilot-baseline/2026-10-05-desktop-beta8-9264bb3` → `9264bb3331c1cd3953689f6fdd32f827332420a8` |
| Installer artifact | `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\SyncBiz-Player-Setup-2.2.8-beta.8-x64.exe`, SHA256 `349152a9d9caa7c81634b2850fa967f2349b0e58eabde1df73e0cc66dfa583ff` |
| Railway TEST deployment | `25b48cc0-03b1-48a9-a1d7-a099420eeabd` (may become non-redeployable once REMOVED — the tag is the fallback) |

Tags are annotated and pushed to origin (owner-approved 2026-10-05). Never use
the `desktop-v*` prefix (triggers the release workflow).

**WARNING:** the desktop source tag does NOT reproduce beta.8 exactly by itself — beta.8 used
temporary TEST-pin edits. Restore the Lenovo from the preserved installer binary, verified by hash.
