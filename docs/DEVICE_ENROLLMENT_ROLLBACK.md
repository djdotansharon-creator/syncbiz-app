# Device enrollment — how to switch it on, and how to go back (2026-10-27)

Everything about device enrollment is **dormant by default**. Nothing changes for any account until BOTH (1) the server has the env flag `SYNCBIZ_DEVICE_ENROLLMENT=1` and (2) a workspace admin switches it on in the Control Room. Going back is possible at every level, from one click to a code revert.

## Levels of "off" (fastest first)
| Level | How | Effect | Loses data? |
|---|---|---|---|
| **A workspace** | Control Room → "New requests" → the **switch** (off) (or `POST /api/control-room/enrollment-settings { enabled:false }`) | that workspace behaves exactly as before: no device needs approval, tokens are minted as before | no — requests / approvals stay for the next time |
| **The server** | remove / set to anything else the env var `SYNCBIZ_DEVICE_ENROLLMENT` and redeploy / restart | the whole feature is invisible: the Control Room panel disappears, the device gate never shows, the token route ignores the device id, **the new table and columns are never queried** | no |
| **The code** | GitHub **Revert** of the merge commit(s) (PR-B first, then PR-A), or Railway → previous deployment | the feature is gone from the running app | no (the table stays unused) |
| **The database** | the SQL below — only after the code is reverted | the two tables are removed | yes, the enrollment rows (the audit-log rows stay) |

## Safe order to ship (each step needs the owner's explicit yes)
**What a migration is:** a one-time command that adds the new tables to the database (like adding sheets to a spreadsheet). The approval feature needs two new tables to store its settings and requests.
**Why the merge no longer depends on it (changed 2026-10-29):** the three migrations create ONLY NEW tables (`DeviceEnrollment`, `WorkspaceEnrollmentSetting`) and change no existing table — the settings that first lived as columns on `WorkspaceEntitlement` now have their own table. With the env flag off the new tables are never read, so **the code can be merged and deployed BEFORE the migration** and the site behaves exactly as before. (An earlier version of the plan added columns to `WorkspaceEntitlement`; merging that before its migration would have broken sign-up and the platform admin dashboard — that was found and removed on 2026-10-28/29. A deploy does not apply migrations: `start` is `next start`.)
1. Merge **PR-A** (rules, API, Control Room tile / requests screen / red circle, "Player / Remote details" in the gear menu) and **PR-B** (the hold, the request screen, the signed role in the token, the WS rule that an approved Remote is never MASTER). With the flag off both are inert; the existing WS regression tests are green.
2. When the owner wants to try it: apply the three migrations to the database (`20261027161357_device_enrollment`, `20261028120000_device_enrollment_requester`, `20261028180000_device_enrollment_branch_details`) — the repo's guard: `npm run db:migrate:deploy` is local-only; for a real database it needs the deliberate `SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL=<that database> npx prisma migrate deploy`, run by someone who holds the database URL (it is not stored in the repo). Purely additive; harmless under old code.
3. Set `SYNCBIZ_DEVICE_ENROLLMENT=1` on the environment and switch ON **one workspace only** (the owner's own) from the switch in its Control Room; try it with the owner's own computers (two or three). Other workspaces stay exactly as they are — the switch is per workspace.
4. Before the switch is turned on for any REAL customer on PROD: the device credential on the data routes (design Phase 4a — see "Known limits").
Switching on **approves every existing station and the admin's own computer automatically** (the admin's computer becomes the owner's computer: normal interface, able to play, never a Player seat), so nothing goes dark.

## SQL to remove the objects (revert the code FIRST)
```sql
DROP TABLE IF EXISTS "WorkspaceEnrollmentSetting";
DROP TABLE IF EXISTS "DeviceEnrollment";
DELETE FROM "_prisma_migrations" WHERE migration_name IN ('20261027161357_device_enrollment', '20261028120000_device_enrollment_requester', '20261028180000_device_enrollment_branch_details');
```

## Local database (this Mac)
The migration is applied to the local `syncbiz_dev` only. To undo it locally: run the SQL above against that database, then `npx prisma generate`. The test helper `design/tools/enroll-cleanup.mjs` removes just the rows a test created and switches the flag off.

## If an admin is ever locked out
The admin who switches enrollment on is approved automatically, and the panel never shows "Revoke" on the device you are using. If it still happens: switch the workspace off by SQL (`UPDATE "WorkspaceEnrollmentSetting" SET "enabled" = false WHERE "workspaceId" = '…';`) or unset the env flag — either returns everything to today's behaviour at once.

## Known limits (v1, written down on purpose)
- The desktop app's own screen (user agent `Electron/…`) is not gated at the token route; stations are governed by the activation code and by the automatic approval at switch-on. An insider could imitate that user agent — the revocable device credential (design Phase 5) closes it.
- Revoking a device takes effect when it next asks for a token (60 s tokens for browsers); a socket that is already connected stays until it reconnects. Pushing a disconnect to the WS server is a later step.
- A desktop token issued before switch-on keeps working for its life (7–30 days). Replacing "absent claim = legacy" with a server-side grandfathered list is design §6 and is not part of v1.
- "Replace the current player" is not offered through enrollment yet (use *Replace main station* in the branch's activation panel); a second Player is a standby.
- Extra tabs of an approved profile share its approval; the existing lease still decides which tab plays.
- The hold (the app is not loaded until approved) is a client-side boundary plus the token gate: a not-yet-approved device cannot play or control, but the data routes still answer to the signed-in session. The revocable device credential (design Phase 4a) closes it.
- A Player's typed NEW branch must be created first in the branches screen; approval needs a real branch (creating it on approval is a later step).
