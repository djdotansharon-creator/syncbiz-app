# CONTROL ROOM F2a — MEMBER SCOPE FOUNDATION (SHADOW / OFFLINE) — ACCEPTANCE (2026-10-07)

> Status: **ACCEPTED 2026-10-07 — TEST only.** Server / DB facts below are **server-log / DB corroborated** (read-only
> TEST queries from the Dev-PC); the Lenovo exit + reopen was performed by the owner. **PROD untouched.**
> Branch `feature/control-room-phase1`. Commit `398cce77662ad4d5fda79c7738556b6620a660f1` (pushed).
> **F2b (live shadow hook) NOT started.** Design: `docs/CONTROL_ROOM_BLUEPRINT.md` §2d (D21).

## 1. What F2a is

Composite permission scopes **stored and evaluated OFFLINE only**. Nothing enforces them and nothing on a request path
reads them. Current authorization (legacy helpers + Gate 3A shadow engine) stays authoritative. Unchanged: tokens, WS,
MASTER/CONTROL, playback, APIs, UI, `lib/authz.ts` / `shadowAuthorize`.

| Item | Implementation |
|---|---|
| `MemberScope` | `(id, memberId → WorkspaceMember Cascade, workspaceId, userId, preset, allLocations=false, status="active", source, sourceRef="", createdBy?, timestamps)`; `@@unique([memberId, source, sourceRef])`; `@@index([workspaceId, userId])`. Presets = Gate 3A's (ADMIN, HQ_CONTROL, REGIONAL_MANAGER, BRANCH_MANAGER, VIEW_ONLY) |
| `MemberScopeTarget` | normalized: `(id, scopeId → MemberScope Cascade, workspaceId, dimension, brandId?, branchId?, zoneId?, zoneTypeCode?)`; dimensions BRAND / LOCATION / ZONE / ZONE_TYPE (F3 adds REGION / GROUP / TAG) |
| CHECK | `MemberScopeTarget_one_value_matches_dimension`: exactly one value column set, matching the dimension |
| Value FKs | Brand / Branch / Zone: NO ACTION, **DEFERRABLE INITIALLY DEFERRED** — a referenced value can never silently disappear (which could broaden an AND row); a whole-workspace cascade still succeeds (found + fixed via the throwaway-DB test before any deploy) |
| Evaluator | `lib/authz-scope.ts` — pure `evaluateScope` (same dimension OR · dimensions AND · rows UNION · capability strictly per row · empty row fails closed · zone-limited row never covers a whole location · NULL brand → default brand · legacy "default" → canonical · suspended / no membership DENY), pure `deriveScopesFromLegacy`, read-only loader with an injected DB client. **Imported by nothing in app / lib / server / desktop.** |
| Translation | SUPER_ADMIN / WORKSPACE_ADMIN → ADMIN + all · MANAGER → HQ_CONTROL + all (legacy-vs-Gate 3A difference NOT fixed) · CONTROLLER / VIEWER → one row per assignment (VIEWER → VIEW_ONLY) · no assignment → explicit `migrated:implicit-default` row on the canonical branch · `"*"` → allLocations, classified `known-star` |
| Tooling | `scripts/control-room/f2-scope.ts` (`fingerprint / dry-run / apply / check / matrix`) via tsx in the TEST container; same TEST guard as F1 (refusal proven) |
| Migration | `prisma/migrations/20261007150000_control_room_f2a_member_scope` (additive only) |

## 2. TEST execution (2026-10-07 UTC)

| Step | Evidence |
|---|---|
| Pre-fingerprint | 18 groups (identity, content, members, assignments, users, F1 brand / zone / bindings) |
| DB backup | `D:\SyncBiz_Backups\test-env\20261007T104212Z-control-room-f2a\` — SHA256 `c2b8d7edd03ec011bb3876707c8d67c1daaf7ffc974fa132de3842286ad9c5b7`; container = local; **restore check PASS** (identical counts, throwaway DB dropped); pre/post fingerprints, `BACKUP-RECORD.txt` |
| Deploy A | `8a9e36f9-1526-4f04-9858-5938e629581a` = `25d4c06` + F2a migration folder only → `prisma migrate deploy` (39 migrations; CHECK present; 3 value FKs deferred) |
| Deploy B | **`54f898f9-bd3c-4267-ba42-5b3edad36a8f`** = `398cce7` (clean tree); 5 key files hash-identical incl. unchanged `lib/authz.ts` |
| Sync | dry-run 1 planned; apply 1 created (WORKSPACE_ADMIN → ADMIN + allLocations; its assignment superseded-by-role); check ok; **second apply NO-OP** |
| Matrix | 1 subject × 9 capabilities × {workspace, canonical location, "default" alias, default zone} = **36 / 36 agree, 0 expected, 0 unexpected** |
| Fingerprint | **0 diffs** in 18 groups vs pre-migration |

## 3. Runtime (after the owner's normal exit + reopen)

| Check | Result |
|---|---|
| Desktop token | `POST /api/auth/desktop/token-from-session` 200 ×2 · `GET /api/auth/ws-token` 200 ×2 |
| Station register | `POST /api/devices/register` 200 ×3 |
| Durable id | `dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f` unchanged |
| MAIN | 10:51:31Z `permanent designation -> MASTER (trusted station)` |
| Renderer | `ba8ffdba-d00b-468d-bf74-f805013d37ef` 10:50:01Z + 10:51:31Z `embedded renderer -> CONTROL` |
| Room | both `ws:31d30e23-8f4a-4bf2-a1df-c707b69b5673:90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2` |
| 409 / branch conflict | none |
| 5xx | only 2 × `POST /api/music-bank/authorize` 503 — pre-existing TEST "not configured" (route unchanged since `e1456a2`; same as F1); not F2a |
| WS service | unchanged (`23e94c01`) |

## 4. Tests (Dev-PC)

`verify-control-room-f2a` 43/43 (pure semantics + translation + parity; throwaway Postgres: 8 synthetic subjects
incl. suspended / orphan / `*`, sync, matrix 648 cells 0 unexpected (27 `known-star`), CHECK + FK + deferral +
workspace cascade, Brand ∧ SPA composite via the loader) · `verify-control-room-f1` 42/42 (A15 scoped to its two
models) · app/server suites 21/23 (same 2 environment-gated scripts as on HEAD) · desktop 20/20 · watchdog 68/0 ·
app + server tsc · `next build` PASS.

## 5. Rollback

Tag `pilot-baseline/2026-10-07-control-room-f2a-398cce7` → `398cce7`; previous F1 tag
`pilot-baseline/2026-10-07-control-room-f1-25d4c06`. DB: restore the F2a backup, or drop `MemberScopeTarget` +
`MemberScope` (additive). App: redeploy `25d4c06` (F1). No desktop / playback / WS involvement.

## 6. Deferred

F2b — live mismatch-only shadow hook in `shadowAuthorize` (separate gate) · owner decision on BRAND_MANAGER /
ZONE_OPERATOR capability sets · dual-write from user management (enforcement gate) · F3 Region / Group / Tags.
