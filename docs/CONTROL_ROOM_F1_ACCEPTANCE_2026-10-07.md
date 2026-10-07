# CONTROL ROOM F1 — BRAND + ZONE FOUNDATION (SHADOW) — ACCEPTANCE (2026-10-07)

> Status: **ACCEPTED 2026-10-07 — TEST only.** Lenovo runtime **owner-attested**; DB / WS / HTTP facts below are
> **server-log / DB corroborated** by this Dev-PC session (read-only TEST queries). **PROD untouched.**
> Branch `feature/control-room-phase1`. Commit `25d4c0685517f235df69fac3fb89c555807ef698` (pushed).
> F2 NOT started. Blueprint: `docs/CONTROL_ROOM_BLUEPRINT.md` (D14–D22, §2, §24); CLAUDE.md §11.

## 1. What F1 is

Additive schema + idempotent TEST-only backfill for **Organization → Brand → Location → Zone → Station**, in SHADOW:
nothing reads Brand / Zone for a runtime decision. Unchanged: authz, tokens, WS rooms, designation store, station
registration, playback, content, desktop.

| Item | Implementation |
|---|---|
| Brand | `Brand(id, workspaceId → Workspace Cascade, name, code, isDefault, status, color?, logoUrl?, sortOrder, archivedAt?, timestamps)`; `@@unique([workspaceId, code])` |
| Location → Brand | `Branch.brandId String?` FK → Brand (SET NULL) |
| Zone | `Zone(id, workspaceId, branchId → Branch Cascade, name, code, zoneTypeCode="MAIN", isDefault, status, sortOrder, timestamps)`; `@@unique([branchId, code])`; index `(workspaceId, zoneTypeCode)` |
| Zone type | flexible canonical **string** code (no DB enum); validated in `lib/control-room-foundation.ts` (`^[A-Z][A-Z0-9_]{0,39}$`); catalog `KNOWN_ZONE_TYPES` (MAIN, LOBBY, POOL, SPA, RESTAURANT, BAR, GYM, ROOFTOP, RETAIL, OUTDOOR, BALLROOM, BEACH, KIDS_CLUB, TERRACE, OTHER); custom valid codes accepted — **no migration per new type** |
| Station / designation → Zone | `StationDevice.zoneId String?`, `BranchMasterDesignation.zoneId String?` FK → Zone (SET NULL). Designation uniqueness unchanged `(workspaceId, branchId)` |
| NULL-zone compatibility | NULL = "the Location's default Zone" (F1 compatibility semantics only; mandatory in a later hardening gate). F1 invariant: every StationDevice and BranchMasterDesignation **resolves** to a valid Zone of its own Location |
| Default uniqueness | partial unique indexes `Brand_one_default_per_workspace`, `Zone_one_default_per_branch` = **AT MOST ONE** default. **EXACTLY ONE** = idempotent backfill + transactional Location creation (`store.addBranch`: default Brand + default Zone in one transaction) + check script. Both proven by test (second default → P2002; zero defaults → check-script violation) |
| Tooling | `scripts/control-room/f1-foundation.cjs` + `f1-backfill.cjs` (`fingerprint` / `check` / `dry-run` / `apply`); refuses unless `VONO_F1_TARGET=TEST` + Railway project `syncbiz-pr52-test` + service `syncbiz-app-test` and the PROD workspace sentinel is absent (refusal proven on TEST) |
| Migration | `prisma/migrations/20261007120000_control_room_f1_brand_zone` (additive only) |

## 2. TEST execution (2026-10-07 UTC)

| Step | Evidence |
|---|---|
| Pre-fingerprint | ids/bindings/content hashes recorded (read-only) |
| DB backup | `D:\SyncBiz_Backups\test-env\20261007T094829Z-control-room-f1\` — pg_dump SHA256 `4d9ea2da808c4fa19bdb0f63d40ea4ae72ccfb5564ea63dd7fd81bcf0e2bc22b`; container = local copy; **restore check PASS** (identical counts in a throwaway DB, dropped); `BACKUP-RECORD.txt`, pre/post fingerprints |
| Deploy A | `bbb98798-8487-4e43-b308-a101b34e402c` = deployed code `483fd28` (no app source change since `3d6a70d`) + migration folder only → `prisma migrate deploy` (38 migrations; both partial indexes verified in `pg_indexes`) |
| Deploy B | **`538902e8-439d-46c4-a38d-ea978c7baaac`** = `25d4c06` from a clean tree; 5 changed files hash-identical to the commit |
| Backfill | dry-run = plan only; apply = 1 brand, 1 branch link, 1 zone, 2 stations, 1 designation, 0 unresolved; check `ok`; **second run = NO-OP** |
| WS | `syncbiz-ws-test` deployment unchanged (`23e94c01`) |

## 3. Final server / DB verification (after the owner's VONO reopen)

| # | Check | Result |
|---|---|---|
| 1 | Lenovo MAIN `dsk-cbeb93d0…` registered in canonical room `ws:31d30e23…:90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2` | **PASS** — 10:03:04Z `permanent designation -> MASTER (trusted station)` |
| 2 | Renderer `ba8ffdba…` CONTROL in the same room | **PASS** — 10:02:23Z + 10:03:04Z `embedded renderer -> CONTROL` |
| 3 | Canonical Branch → default Brand | **PASS** — `11db397d-d530-446a-943b-18d57c8cd7fd` / `MAIN` |
| 4 | Exactly one default Zone | **PASS** — `6739408a-b47c-47c5-868f-59c53add65b0` / `MAIN` (zoneTypeCode MAIN) |
| 5 | Lenovo StationDevice → that Zone | **PASS** |
| 6 | Dev-PC StationDevice `dsk-9b11bfa1…` → that Zone | **PASS** |
| 7 | Lenovo designation → that Zone | **PASS** (designated device unchanged) |
| 8 | No Branch id `"default"` | **NONE** |
| 9 | Fake StationDevice rows | **NONE** (2, unchanged) |
| 10 | Fake designation rows | **NONE** (1, unchanged) |
| 11 | Content attached exactly as before | **PASS** — fingerprint vs pre-migration: **0 diffs** (workspace, branch, stations, designation, assignments, playlists 6, pads 5, announcements 2, schedules, sources) |
| — | Token / register through F1 code | `POST /api/auth/desktop/token-from-session` 200 ×2, `POST /api/devices/register` 200 ×3, `GET /api/auth/ws-token` 200 ×4; **0 × 409**; only 5xx = 2 × `music-bank/authorize` 503 (pre-existing TEST "not configured", route unchanged since `e1456a2`) |
| — | F1 check script | `ok: true`, 0 violations |

**Lenovo runtime — ACCEPTED, owner-attested 2026-10-07:** beta.12; token/register PASS; durable station id preserved;
MAIN MASTER; renderer CONTROL; LOCAL PASS; LOCAL NEXT PASS; URL PASS; no 409; no branch conflict; no watchdog restart.

## 4. Tests (Dev-PC)

`verify-control-room-f1` 42/42 (pure + real throwaway local Postgres with all 38 migrations, dropped afterwards) ·
app/server suites 20/22 (2 environment-gated scripts fail identically on unchanged HEAD; not in the accepted matrix) ·
desktop suites 20/20 · watchdog self-check 68/0 · app + server tsc · `next build` PASS.

## 5. Rollback

| Layer | Reference |
|---|---|
| Git | tag `pilot-baseline/2026-10-07-control-room-f1-25d4c06` → `25d4c06`; previous app source `3d6a70d` (tag `pilot-baseline/2026-10-07-renderer-3d6a70d`) |
| DB | restore the F1 backup dump, or drop the additive objects (Zone, Brand, the three nullable columns, two partial indexes) |
| App | redeploy the pre-F1 source; Railway deployment `538902e8` is the F1 reference |

Playback rollback is not involved (no desktop / playback / WS change; Desktop baseline remains beta.12).

## 6. Not in F1 (deferred, each its own gate)

F2 composite scopes (shadow) · F3 Region / Group / Tags · F4 Brand Board UI · F5 integrity hardening (stub-branch
paths, unique location code, NOT NULL brand/zone) · F6 compact tokens + enforcement · F7 multi-zone runtime (zone
designation uniqueness, zone WS room format, activation codes, ZoneStatus, targeting, bulk import).
