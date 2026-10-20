# CONTROL ROOM F3a — LOCATION CLASSIFICATION FOUNDATION (SHADOW) — ACCEPTANCE (2026-10-07)

> Status: **ACCEPTED 2026-10-07 — TEST only.** Server / DB facts **server-log / DB corroborated** (read-only TEST
> queries from the Dev-PC); the Lenovo VONO reopen was performed by the owner. **PROD untouched.**
> Branch `feature/control-room-phase1`. Clean commit **`ca8312e81b92e6ac82e970f09d3007e1f8f87546`** (pushed) on
> `4fdd719`. The beta.13 playback diagnostic `3ef27b8` is **NOT** in this lineage (kept on the local branch
> `diag/beta13-long-url-eof`, not pushed). F2b / F3b / UI NOT started.

## 1. What F3a is

Additive, SHADOW location classification for Organization → Brand → Location → Zone → Station. Nothing reads it at
runtime: no authz enforcement, token, WS, MASTER / CONTROL, playback or UI change.

| Item | Implementation |
|---|---|
| `Region` | org-level; `code` canonical (`^[A-Z][A-Z0-9_]{0,39}$`, DB CHECK) + unique per org; archive not delete; ONE primary per Location via `Branch.regionId` (FK NO ACTION, DEFERRABLE INITIALLY DEFERRED) |
| `LocationGroup` + `LocationGroupMember` | managed operational cohort (zero or many per Location); flat; composite `(id, workspaceId)` FKs → cross-workspace membership rejected by the DB |
| `LocationTag` + `LocationTagAssignment` | lightweight annotation (zero or many per Location); same composite FKs |
| `Branch` additions (all nullable) | `regionId`, `locationCode` (unique per workspace, NULLs allowed; `Branch.code` untouched), `addressLine1`, `addressLine2`, `postalCode`, `stateProvince` |
| MemberScope | dimensions **BRAND, LOCATION, ZONE, ZONE_TYPE, REGION, GROUP** — `MemberScopeTarget.regionId` / `groupId` (deferred NO ACTION FKs); CHECK replaced for 6 dimensions; a row with any unknown dimension fails closed |
| **LOCKED — Tag is NOT a permission dimension** | no tag column on `MemberScopeTarget`, no TAG in the CHECK, the evaluator never receives tag ids; re-tagging changes no access decision |
| Filter resolver | `lib/location-filter.ts` (pure, offline): BRAND, REGION, GROUP, TAG, LOCATION, ZONE, ZONE_TYPE — OR within / AND across / union; archived values never match; null region never matches a region constraint; NULL brand = default brand. Shared `matchLocation` with the scope evaluator |
| Tooling | `scripts/control-room/f3-classification-core.ts` (check + guarded `locationCode` backfill) |
| Migration | `prisma/migrations/20261007200000_control_room_f3a_location_classification` (additive; only DROP = CHECK replacement) |

## 2. TEST execution (2026-10-07 UTC)

| Step | Evidence |
|---|---|
| Pre-checks | fingerprint (18 groups), F1 ok, F2a matrix 36/36, scope check ok |
| DB backup | `D:\SyncBiz_Backups\test-env\20261007T195345Z-control-room-f3a\` — SHA256 `fcdf6a4a458e0791e6f27be9272c3d481aab357508791136cbe838a700dd8db7`; **restore check PASS**; pre/post fingerprints, `BACKUP-RECORD.txt` |
| Deploy A | `71cfcb1c-cecc-4811-bdbb-85de9fffcec4` = `4fdd719` (app source == live `d617314`) + F3a migration folder → `prisma migrate deploy` (40 migrations; constraints / deferral / no tag column verified) |
| Deploy B | **`4d2b0f53-2361-4401-9c92-5034c99e97e1`** = `ca8312e` (clean tree; key files incl. playback renderer files hash-identical; no diagnostic file in the container) |
| F3a check | ok, 0 violations (before + after backfill) |
| locationCode backfill | dry-run 1 · apply 1 (`90d2b7b8…` → `T001`) · second run **NO-OP** |
| F1 / F2a | F1 ok · scope check ok · matrix **36 agree / 0 expected / 0 unexpected** |
| Fingerprint | **0 diffs** in 18 groups vs pre-migration (only approved change: `Branch.locationCode = T001`); no Region / Group / Tag rows created |

## 3. Runtime (owner's normal VONO reopen ~20:03Z; server-log corroborated)

`POST /api/auth/desktop/token-from-session` 200 ×2 · `GET /api/auth/ws-token` 200 ×3 · `POST /api/devices/register`
200 ×3 · MAIN `dsk-cbeb93d0…` 20:03:46Z `permanent designation -> MASTER (trusted station)` · renderer `ba8ffdba…`
20:03:22Z + 20:03:49Z `embedded renderer -> CONTROL` · room `ws:31d30e23…:90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2`
(canonical, unchanged) · 0 × 409 · no branch conflict · only 5xx = 2 × pre-existing `music-bank/authorize` 503.
Post-reopen data: `locationCode` T001, 1 branch / 0 regions / 0 groups / 0 tags, F1 + F3a checks ok, fingerprint 0 diffs.

## 4. Tests (Dev-PC)

`verify-control-room-f3a` 43/43 (pure + throwaway Postgres seeded with the PRE-F3 client then migrated) ·
`verify-control-room-f2a` 43/43 · `verify-control-room-f1` 42/42 · app/server suites unchanged (same 2
environment-gated scripts) · desktop 21/21 · watchdog 68/0 · tsc + `next build` PASS.

## 5. Rollback

Tag `pilot-baseline/2026-10-07-control-room-f3a-ca8312e` → `ca8312e`; previous Control Room tag
`pilot-baseline/2026-10-07-control-room-f2a-398cce7`. DB: restore the F3a backup, or drop the F3a tables / columns
(additive). App: redeploy `4fdd719` (renderer behaviour identical to `d617314`).

## 6. Deferred

F3b admin CRUD / assignment API · F3c bulk-import dry-run · F4 Brand Board UI · F2b live shadow hook · enforcement /
compact tokens (F6) · multi-zone runtime (F7). Tag-based operational targeting needs its own explicit product decision.
