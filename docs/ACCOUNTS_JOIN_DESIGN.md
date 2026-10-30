# Accounts — join a business by a one-time code (stage 1 of the new accounts model)

Owner brief 2026-10-29: every person has their own sign-in; a new person either **sets up a new business** or **joins an existing one** with a one-time code the business manager creates; the manager approves and picks the role.

## Status: BUILT, DORMANT (stage 1 of 4)

| Piece | Where |
|---|---|
| Rules (code alphabet, 10-minute code, 7-day request, input checks, roles) | `lib/join-by-code.ts` (pure) |
| Database side (make code, request, list, approve / reject, audit) | `lib/join-by-code-store.ts` |
| Public: flag, send request | `GET /api/join/config`, `POST /api/join/request` |
| Admin (workspace admin only): make code, list, decide | `POST /api/join/codes`, `GET /api/join/requests`, `POST /api/join/requests/[id]` |
| Sign-up in steps (details → new / join → code) | `components/join/signup-flow.tsx`, chosen by `app/signup/page.tsx` |
| Owner side: the **People grid** of the Permissions screen (a square per person, the plus tile makes the one-time code + its QR, waiting people are squares too) | `components/roles/people-grid.tsx`, `qr-code.tsx`, vendored `lib/vendor/qrcode-generator.js` |
| Tables (two NEW, nothing existing touched) | `WorkspaceJoinCode`, `WorkspaceJoinRequest` — migration `20261029120000_join_by_code` |
| Tests | `scripts/verify-join-by-code.ts` (12), `scripts/verify-join-by-code-db.ts` (22, real local DB) |

**Dormant:** needs the env flag `SYNCBIZ_JOIN_BY_CODE=1` AND the migration. Flag off = the old sign-up page, the new tables are never queried, the join endpoints answer 404 (the list answers `enabled:false`).

## Decisions made while building (change on request)
- **Code:** 8 symbols (no I/O/0/1), shown `ABCD-EFGH`, **valid 90 seconds** and renewed every minute while the "add a person" window is open (owner 2026-10-31); a person who opens the link keeps that code alive 10 minutes to fill in his details (`/api/join/claim`), works once, only its sha256 is stored. At most 10 unused codes per business.
- **A new person has no account until approved.** The request keeps their details and the password *hash*; sign-in is untouched (a person without a business could not sign in anyway). A person who already has an account must give that password; approval just adds the business to it.
- **Approval roles for now:** Manager (= existing TENANT_ADMIN → `MANAGER`) / Member (= `CONTROLLER`), default branch assignment as the existing Access Control "add user" does. Custom roles with switches = stage 2.
- **Guessing:** the join call uses the same 10-failures / 15-minute limiter as sign-in (per e-mail and per address).
- **Business seat limit** (`SYNCBIZ_ENFORCE_LIMITS`) is checked at approval; a full business leaves nothing half-made.
- **Birth date is not collected** (no use for it, and it only lowers sign-ups).

## Known gaps (not built yet)
- ~~No QR code~~ — built 2026-10-30: the plus tile shows a QR of the sign-up link with the code inside (`/signup?join=ABCD-EFGH`); a person who scans it lands on the join step with the code filled in. The generator is VENDORED (no new npm dependency). The other direction (the owner scans a QR shown by the new person) is not built.
- No e-mail check: the approver vouches for the person (the request shows name + e-mail + phone). Two-step sign-in is a later item.
- No red dot for waiting people on the Control Room tab; the panel is in Access Control until stage 3 moves it.
- The payment step for the first Player: no payment provider is connected yet.
- A waiting person who tries to sign in before approval sees the normal "wrong e-mail or password".

## Turn it on (PROD or TEST — deliberate, by someone with database access)
1. `SYNCBIZ_ALLOW_PROD_DB=1 DATABASE_URL=<target> npx prisma migrate deploy` (applies only `20261029120000_join_by_code`, plus any still-pending enrollment ones).
2. Set `SYNCBIZ_JOIN_BY_CODE=1` on the service and redeploy.

## Rollback
- Switch off: remove `SYNCBIZ_JOIN_BY_CODE` (or set 0) and redeploy — the old sign-up returns at once; no data is lost; rows stay for next time.
- Remove the feature: revert the merge commit. The two tables may stay (unused) or be dropped:
  `DROP TABLE "WorkspaceJoinRequest"; DROP TABLE "WorkspaceJoinCode"; DELETE FROM "_prisma_migrations" WHERE migration_name = '20261029120000_join_by_code';`
- Accounts created by an approval are ordinary accounts (kept).


## 2026-10-31 — live card for the approver
A new request pops up as a small card (name, role list, Approve / Reject / Later) on the control screens only — the owner's phone/computer and the Player computer inside Settings, never over the music (`components/roles/join-popup.tsx`). It appears within ~4 s on a screen that is showing the code and within ~15 s on another approver screen; the red circle stays as the fallback, and a request older than 5 minutes does not pop up. The steps of the phone app (sign up, then "new / join", then scan or type the code) and of the computer app (log in or create an account, or link to a player by code, no scan; in the Players tab) are for the apps and are NOT built here.
