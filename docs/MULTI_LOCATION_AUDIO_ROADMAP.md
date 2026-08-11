# SyncBiz — Multi-Location Audio OS · Roadmap (living source of truth)

> This is the **single** living roadmap. Update it in place — no `_v2` / `_final` copies.
> Architecture anchors live in `docs/PROJECT-STATE.md`; playback rules there are binding.
> Last updated: 2026-08-11.

---

## 📍 STATUS (update this block first, every milestone)

- **Current Milestone:** P1.2 — MASTER Crash / Lease Recovery Reliability — **AWAITING OWNER APPROVAL** (do not start automatically).
- **Current Gate:** n/a until P1.2 is approved and scoped.
- **Last Completed:** **P1.1 — Playback Regression Harness** — **Gate: PASS.** 5 consecutive green full-suite runs against a local production-like build (`next build`+`next start`); Automix now a real PASS (multi-track playlist idx0→idx1). Automated: Play · Navigation-Survival · Automix · Queue-Integrity · Reconnect. Integration/Manual (documented): CONTROL lifecycle, Desktop/MPV interruption. Root cause of prior flakiness = `next dev` (RSC remounts / token churn), proven by determinism under the production build.
- **Next Approved Step:** P1.2 requires explicit approval. Do NOT auto-start Source P1.
- **Blockers:** none blocking. Latent: production is 11 migrations behind (deploy is owner-gated; NOT a bug).
- **Known Reliability Finding:** stale primary MASTER lease during the 90s grace after a crash can force a new playing device to CONTROL → `stopForControlHandoff` wipes the session (eject class). → P1.2.
- **Key Decisions:** see "Decisions log" below.

---

## 1. Product Vision
SyncBiz is a **Multi-Location Audio Operations Platform** for businesses and multi-branch chains — not "Spotify for Business". Strong go-to-market: **AI In-Store Radio / Retail Media OS** for retail chains (supermarkets, DIY, department, beauty, lifestyle). Retail is the GTM, **not** the architecture boundary — the core must also serve fitness / hospitality / restaurants / hotels later.

Future single-system scope (do NOT build now): Music · Playback · Sources · Branches · Organizations · Users · Permissions · Scheduling · Announcements · AI Voice · Jingles · Campaigns · Retail Media · Reporting · Proof-of-Play.

## 2. Non-Negotiables
- **A. Playback stability before significant expansion.** The player must never stop; navigation/refresh/transient failures must not affect the MASTER audio. Local-first / offline-capable.
- **B. Production DB safety.** Railway production is never risked.
- **C. Additive over rewrite.** No large rewrite when an additive/incremental path reaches the goal.

Every decision asks: improves reliability? simplifies the product? prevents a future rewrite? serves a real use-case? has an acceptance gate? safe for production?

## 3. Architecture (summary — anchors in PROJECT-STATE.md)
Next.js app (`app/`,`components/`,`lib/`) + standalone WS server (`server/`, :3001, per-branch MASTER lease) + Electron desktop player (`desktop/`, dual MPV decks). PostgreSQL/Prisma. **UniversalTrack** identity pipeline + **P0 Source Architecture** (Provider/Connection/Container/Locator) are the source-agnostic foundation. Playback resolves everything to a URL string the player consumes; file-backed cloud sources will mint a signed URL at play time into the SAME path (no player change).

## 4. Current State
| Domain | State | Note |
|---|---|---|
| Playback (browser MASTER / desktop MPV) | 🟢 EXISTS | GREEN baseline; eject/flicker/MASTER-lock/dual-deck solved; self-heal watchdog |
| Sources / UniversalTrack / P0 Source-arch | 🟢 EXISTS | identity pipeline (no false-merge); P0 Connection/Container/Locator applied, zero drift |
| Library / DJ Creator / Music-Library metadata | 🟢 EXISTS | tiers; center-monitor; Layer-A/B READ-ONLY law |
| Tenancy (Workspace/Branch) | 🟡 PARTIAL | flat Workspace; real `Branch` but `branchId` is a loose string in ~4 tables; **no Organization/Region**; 36× hardcoded `"default"` |
| Permissions | 🟡 PARTIAL | 5 roles → **2 effective** (OWNER/BRANCH_USER); **no capability/ACL** (UI "Capability Layer" is informational only) |
| Scheduling | 🟡 PARTIAL | flat model; **executor = client-poll (open tab)**, not server-cron; `cronExpr`/`ScheduleStatus` dead; no override layering |
| Announcements / Jingles | 🟡 PARTIAL | TTS (ElevenLabs) works; **injection desktop-only**; `Announcement` DB **orphaned**; jingle metadata in localStorage |
| Telemetry | 🟢 EXISTS | `PlaybackIncident` + `/admin/platform/telemetry` (reliability-only) |
| Device online/offline | 🔴 DEBT | live truth in-memory in WS only; `Device.isOnline` never updated at runtime → UIs show stale data |
| Proof-of-Play | 🔴 MISSING | no persisted "what/when/where played"; only a 500-entry in-memory log |
| Reporting | 🟡 PARTIAL | only incidents + billing/quota; no stores-online / plays / campaigns |

## 5. Critical Risks
1. **Migration-history ordering bug** — `music_library_metadata` touched `LocalTrackFile` before `local_library_sync` created it. **FIXED in P0** (forward-only reorder; prod never had it). *Resolved.*
2. **`.env` prod footgun** — Prisma CLI defaulted to Railway prod. **Mitigated in P0** (`scripts/prisma-safe.mjs` + guarded `db:*` scripts). *Resolved for the sanctioned path.*
3. **No reliable Playback Regression Harness** — `verify-player.mjs` flakes at SETUP. → **P1.1**.
4. **Foundation debt for multi-location** — hardcoded `"default"`, loose `branchId`, no org hierarchy, no capability layer, no scope primitive, no proof-of-play, stale device presence. → **P2**.

## 6. Milestones

### P0 — Safety & Deploy-Unblock ✅ COMPLETE (this session)
- **Goal:** remove the only active blockers so DB work can deploy and dev tooling works.
- **Delivered:** (1) migration reorder `local_library_sync` → before `music_library_metadata` (content-identical rename, dev record reconciled); (2) `scripts/prisma-safe.mjs` + `db:migrate*` scripts forcing local `syncbiz_dev`; (3) clean commit of the P0 Source Architecture (schema + `20260810120000_p0_source_connection_container_locator`).
- **Gate (met):** fresh scratch DB full replay from empty → all migrations incl. P0 apply; scratch **zero drift**; dev `migrate status` up to date + **zero drift**; prod-guard forces local; production untouched (READ-ONLY status checks only).
- **Risk:** low (rehearsed on throwaway DB before touching dev). **Parallel-safe:** yes (independent of playback).

### P1 — Foundation Lock (before any feature expansion)
- **P1.1 Playback Regression Harness ✅ COMPLETE (Gate: PASS).** `scripts/verify-player.mjs` (`npm run test:playback` / `:soak`) + read-only `HarnessPlaybackProbe` (`window.__sbState`, gated on `NEXT_PUBLIC_SB_HARNESS=1`, absent in real deploys). Condition-based (no hidden sleeps), SETUP↔PLAYBACK failure-code separation. **Runs against a local production-like build** (`next build`+`next start`, local DB+WS overrides) — 5 consecutive green.
  - **Automated (PASS ×5):** Play Starts · Navigation Survival · Automix/end-of-track (multi-track playlist idx0→idx1) · Queue Integrity · Reconnect.
  - **Integration/Manual (documented, not auto-PASS):** CONTROL lifecycle (multi-device) · Desktop/MPV local interruption. **Soak:** `--soak` mode.
  - **Finding:** `next dev` was the flakiness source (RSC remounts / ws-token churn); deterministic under prod build.
- **P1.2 MASTER Crash / Lease Recovery Reliability** *(next; approval required; do NOT auto-start)* — a crashed MASTER leaves `primaryMasterByBranch` pointing at the dead device for the 90s grace; a new playing device gets forced to CONTROL → `stopForControlHandoff` wipes the session (eject class). Goal: MASTER crash → playback continuity/recovery; a new MASTER is never falsely ejected by a stale primary lease. **Anchors:** `server/index.ts` (grace/primary gate), `server/master-lease-store.ts` (no TTL; persists across restart), `lib/device-player-context.tsx` (`stopForControlHandoff`).
- **P1.3 Source P1** *(deferred; re-decide after P1.2)* — reader interface v2 / provider descriptors, minimum additive for Drive/Dropbox. Confirmed P0 is the correct base.
- **P1.4 Org/Branch foundation** *(design only)*.

### P2 — Core Multi-Location
Device-presence persistence (WS→DB) + "stores online / now-playing" surface · **Proof-of-Play** model · **server-side schedule executor** (replace client-poll) · Organization/Region hierarchy + branches table + friendly Users/Permissions UX · **minimal Scope primitive** (apply-to-branches shared by playlists/schedules/announcements).

### P3 — Retail / Radio Expansion
Unify announcement injection to the **web** player (safe duck/interrupt path) + wire `Announcement` DB to a real executor · scheduled announcements · AI Campaign engine (promotion → copy → voice → jingle → schedule → scope → proof-of-play) · campaign/retail reporting.

### LATER
AI Radio Personality · Rights-cleared / AI-generated music catalog · retail-media marketplace · SoundCloud · real capability-ACL enforcement.

## 7. Acceptance Gates (principle)
No milestone starts before the previous one passes a **measurable** gate — never "seems to work". Each milestone above carries its gate.

## 8. Parallelization
- **May run in parallel:** DB/migration safety ⟂ harness design; Proof-of-Play ⟂ device-presence; Org-UX design ⟂ backend.
- **Must NOT run in parallel / serialize + verify:** anything touching the playback chain (surgical rule); web announcement-injection **only after** the harness; feature refactors onto the Scope primitive **only after** it lands.

## 9. What NOT to Build Yet
Retail Campaign Engine · AI Radio Personality · capability-ACL enforcement · enterprise Scope engine · rights-cleared catalog — all require P1/P2 foundations first.

## 10. Decisions log
- **Playback accepted GREEN** for browser single-MASTER (4 risk seams verified; none reproduces). CONTROL-mirror staleness + live/huge-duration parked as backlog — touch only on real repro.
- **P1.1 harness runs against a production-like build, not `next dev`.** `next dev` (RSC remounts / ws-token churn) caused all observed harness flakiness; the production build is deterministic (5/5 green). The harness probe is a read-only diagnostic gated on `NEXT_PUBLIC_SB_HARNESS=1` — never present in a real deploy. Multi-track Automix uses an existing DJ-AI playlist (no new fixture / no data change).
- **MASTER-lease reliability FINDING (→ P1.2):** the lease has no TTL and persists across WS restart (`master-lease-store.ts`); cleanup is lazy (on next access after 90s grace). The accumulation of many stale keys was a test artifact, BUT the underlying mechanism — a ghost `primaryMasterByBranch` within the 90s grace after a crash forcing a new playing device to CONTROL (`stopForControlHandoff` → session wiped) — is a **real reliability risk** in that window. Not fixed (flagged for P1.2).
- **Source architecture:** separate `SourceLocator` (not a `ProviderMapping` God-Object); `stableExternalId` is strong identity only within a provider; cross-source identity via ISRC → future fingerprint; `contentHashAlgorithm` stored; local uniqueness by `deviceId`. `SourceConnection` is a superset of `SpotifyConnection`/`LocalLibrarySource` for future lossless migration (not now).
- **Migration safety:** forward-only reorder (prod never applied the broken pair); prod-guard makes local the default, prod requires explicit `SYNCBIZ_ALLOW_PROD_DB=1`.
- **Honesty corrections vs vision:** Permissions backend is binary (no ACL) — friendly UX would sit on a binary model; granular permissions need net-new modeling. Announcements are PARTIAL (console/TTS/desktop-injection exist; web-injection + DB-executor missing). Scheduling executor is client-poll, not production-grade for unattended stores.

## 11. Documentation map
- **This file** — product vision, roadmap, milestones, gates, decisions, current/next step.
- **`docs/PROJECT-STATE.md`** — architecture live map + anchors + binding playback rules.
- **`CLAUDE.md`** — entry point (pointers only, kept short).
