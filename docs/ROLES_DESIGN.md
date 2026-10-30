# Roles with switches + the owner's own access code (stage 2 of the new accounts model) — 2026-10-29

Owner brief: the business owner **defines the roles** of his business (manager, shift manager, employee, partner …), each with **switches** — above all **"may sign in from a computer"** (a worker who only needs the phone must not log in from a home PC) — and **chooses the role when approving** a person who joined with a code. He also chooses **his own access code** for Settings on the player computer (it is `123` until he does).

## Status: BUILT, DORMANT
Needs the env flag **`SYNCBIZ_ROLES=1`** and the migration **`20261029200000_roles`** (three NEW tables: `WorkspaceRole`, `WorkspaceMemberRole`, `WorkspaceAccessCode`; no existing table changes). Flag off: nothing reads these tables, `GET /api/roles` answers `enabled:false`, the panel draws nothing, join approval uses the plain Member / Manager choice, the unlock code is `123` / `SYNCBIZ_MANAGEMENT_CODE`.

| Piece | Where |
|---|---|
| Rules (defaults, validation, the door check, the code hash) | `lib/roles.ts` (pure) |
| Database side | `lib/roles-store.ts` |
| API (workspace admin only) | `GET/POST /api/roles`, `PATCH/DELETE /api/roles/[id]`, `POST /api/roles/access-code` |
| Owner panel "Roles" (top of Access Control) | `components/roles/roles-panel.tsx` |
| Pick a role when approving a joiner | `components/roles/people-grid.tsx` (the request tile), `lib/join-by-code-store.ts` (`roleId`) |
| The door: a computer is turned away for a person whose role forbids it | `app/(app)/layout.tsx` + `components/roles/computer-blocked.tsx` |
| The owner's code replaces 123 | `app/api/auth/management-unlock/route.ts` |
| Tests | `scripts/verify-roles.ts` (13), `scripts/verify-roles-db.ts` (18, real local DB) |

## Only switches that are ENFORCED are offered (a switch that did nothing would be a lie)
1. **Opens the Control Room** → decides the platform role the person gets (on = `MANAGER`: the Control Room / Dashboard pages that already check it; off = member). Changing it later re-maps everyone who has the role.
2. **May sign in from a computer** → enforced at the door: on a **computer** a person whose role has it off sees only "Sign in from your phone" + Sign out. **A phone and the desktop app (the station) are never blocked**; people **with no role are never affected**; any error lets the person in. (A tablet counts as a computer.)
More switches (control the player, edit the library, approve devices, manage people) come **with their enforcement**, not before.

## Ready-made roles
Every business starts with **Manager** (Control Room on), **Shift manager**, **Employee** (all may use a computer). The owner renames / changes / deletes them and adds his own (max 20; a role people still have cannot be deleted).

## Decisions made while building (change on request)
- Default for every ready-made role: computer **allowed** (so nobody is locked out by accident while the phone screens are still a later phase). The owner turns it off per role.
- The access code is 3–12 letters or digits, stored salted + hashed; once the owner has chosen one, **123 stops working** for his business. A failing read falls back to the default (never locks anyone out).
- Roles are assigned at approval. **Changing the role of an existing member** from this screen is not built (Access Control still edits their base access).

## Turn on / off / rollback
1. `SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL=<target> npx prisma migrate deploy` (applies `20261029200000_roles` and anything older still pending). 2. Set `SYNCBIZ_ROLES=1`, redeploy.
Off: remove the variable and redeploy — instant; rows stay. Remove: revert the merge commit; optionally
`DROP TABLE "WorkspaceMemberRole"; DROP TABLE "WorkspaceRole"; DROP TABLE "WorkspaceAccessCode"; DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029200000_roles';`


## 2026-10-31 — computer switch is OFF by default
"May sign in from a computer" is OFF for every ready-made role and for a role the owner adds; the owner turns it on per role. A computer that is allowed in is a Remote (it never plays). The owner's own computer is a Remote too; to play from a computer it must be approved as a Player, which takes a numbered seat. The owner plays free only from the phone (phone app not built yet).
