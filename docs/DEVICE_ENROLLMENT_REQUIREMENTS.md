# New computers, phones and branches: approval before they play or control (owner requirement, 2026-10-27)

**Status: REQUIREMENT ONLY — nothing built. Needs a design gate (server + database, MASTER/WS area) and the owner's approval before any code.**
Source: owner's own words in chat, 2026-10-27. Labels: `EXISTING` / `EXTEND` / `NEW`.

## Why this came up
Two people (owner and his father) signed in to the SAME account on two computers. The system allows ONE player per branch, so one of them silently became a remote and "play" did nothing. A plain "each computer plays for itself" rule is **wrong** for the product (rejected by the owner): a branch has one player, many people log in under one customer account, and the manager must decide which device is what.

## The model the owner wants
1. A customer account (e.g. a supermarket chain) pays for an **allocation**: N branches / players / controllers.
2. Devices already enrolled (stations, installed with an activation code, or approved before) just work, automatically.
3. A **new computer or phone** signs in with the account. The system recognises right after login that this device is **not enrolled** under the account.
4. The device does **not** play or control anything yet. It shows "waiting for the manager's approval" and sends an **approval request**: "may this device be a Player / a Remote?" (with name, platform, time).
5. The **manager** sees the request in the **Control Room** (and in the manager's app), chooses the role (Player or Remote) and the branch / zone, within the paid allocation, and approves or rejects. Approval is revocable.
6. Same rule for computers, phones and branches. Several players under one account are normal; the **split and the allocation are decided in the Control Room**.
7. **A new branch** works the same way: when a computer connects as the player of a branch that is not yet in the system, the manager gets a request "new branch" and approves it **under the branch allocation** the business pays for (an unused seat is consumed; no free seat = the request waits or is refused).
8. **Device status API:** right after login the device sends its durable device id and asks the server "what am I?"; the answer is one of `approved` (with role + branch / zone), `pending`, `unknown` (→ create the request), `rejected`, `revoked`. Every client (computer, phone, station) uses the same call; the server is the only source of truth.
9. On every screen, a small **icon** in the top bar (no frame) says what that screen is — a green speaker = **Player**, a blue remote control = **Remote** — outside the player itself. (**Done in PR #69**: display only.)

## What exists today
- `EXISTING` `StationDevice` (durable device id, workspace, branch, zone), `BranchMasterDesignation` (the one permanent MASTER per branch / zone), Zones, signed token claims, the WS rooms. Design decision D2 (docs/CONTROL_ROOM_BLUEPRINT.md): a **station** is enrolled with an **activation code**, no person's password stays on an unattended machine; D22: onboarding is bulk-import first.
- `EXISTING` for browsers that are not designated stations: legacy per-branch lease — first device to register is MASTER, everyone else is CONTROL, 90 s grace, no failover on designated branches.
- `NOT BUILT`: a **pending-device record**, the **approval request**, the Control Room list "waiting for approval", **allocation counters** (paid seats), a per-device **role** for browsers and phones, and the login-time check "is this device enrolled?".

## Audit 2026-10-27 — how much already exists (read-only; code + schema, nothing run against PROD)
| Piece of the model | State | Where |
|---|---|---|
| **One-time activation code** for a branch | `EXISTING` (Step A + B1) | `BranchActivationCode` (6 random digits, 60 min, single use, only an HMAC hash stored, a new code revokes the old one, purpose `install` / `replace`); generated in the Control Room (`app/api/control-room/branches/[id]/activation-code`, `components/control-room/station-activation.tsx`) |
| **Computer redeems the code** and becomes the branch's main station | `EXISTING` (desktop app only) | `components/station-activation-gate.tsx` ("Activate this station": Station ID + code) → `POST /api/stations/activate` → binds a `StationDevice`, writes the designation, tells the player server; a designated station (the Lenovo) never moves |
| **"What am I?" status call** for a computer | `PARTLY` | `GET /api/stations/activate?deviceId=…` answers only "designated or not, branch name, station id" — for stations, not for browsers / phones, no pending / rejected / revoked |
| Allocation numbers | `PARTLY` | `WorkspaceEntitlement` has `maxBranches`, `maxDevices`, `maxUsers`, `maxPlaylists`; enforcement exists **only behind `SYNCBIZ_ENFORCE_LIMITS=1`** (`lib/entitlement-limits.ts`) and is off by default; billing / add-on tables exist |
| Users per branch, scopes, permissions | `EXISTING` | `UserBranchAssignment`, `MemberScope(+Target)`, Brand / Location / Zone / Region / Group / Tag |
| Control Room (map, branches, brands, networks) | `EXISTING` | `app/api/control-room/*` |
| **New computer / phone signs in → "not enrolled" → approval request** | `NOT BUILT` | no pending record, no request endpoint, no "waiting for approval" screen |
| **Manager approves as Player or Remote, within the allocation** | `NOT BUILT` | no list in the Control Room, no approve / reject / revoke |
| **Phone and browser roles** (a Remote that never tries to be MASTER) | `NOT BUILT` | browsers / phones still use the legacy lease (first to register plays) |
| **New-branch request** (a computer connects as the player of a branch that does not exist yet) | `NOT BUILT` | branches are created by the manager (bulk import first, D22) |

So the **one-time code is the right tool for a station** (an unattended branch computer, no password stays on it) and it is built end to end for the desktop app. The owner's approval request is the **second door** for people's computers, phones and new branches; it reuses the same pieces (`StationDevice`, designation, entitlement counters, Control Room) but needs a new enrollment record, endpoints and screens.

## Proposed phases (each one needs the owner's yes)
1. **Icon (done, renderer only):** Player / Remote icon in the top bar (PR #69).
2. **Design gate (docs only):** exact data model (`DeviceEnrollment`: pending / approved / rejected / revoked, role, branch / zone, who approved, when), how it relates to D2 activation codes (codes for unattended stations; approval requests for people's computers and phones), allocation rules, what a not-yet-approved device may see.
3. **Server + DB (additive migration):** enrollment table, request endpoint, approve / reject / revoke endpoints with owner / admin permission, signed token claim carries the approved role.
4. **Control Room UI:** "Waiting for approval" list, approve as Player / Remote + branch / zone, allocation usage.
5. **Device side:** after login a not-enrolled device shows the waiting screen; an approved Remote never tries to become MASTER; the lease / grace logic stays for legacy accounts only.
6. **Phones:** the same flow in the phone app.

## Until then (testing rule of thumb)
Two people must not sign in to the same account's branch at the same time expecting two players. Only one of the open screens is the player; the others are remotes (the new label shows which).

## Owner's answers (2026-10-27) — decisions, now in `docs/DEVICE_ENROLLMENT_DESIGN.md`
1. **Remote without a branch / one Remote over several branches:** depends on the person's rank; the main owner controls the allocations; a branch owner reaches only their branch; an owner of several branches reaches several; it must be **dynamic** — the account / brand owner decides what each role may do and where.
2. **Who approves:** the main owner can do everything; a branch owner chooses how their branch shows (display, hours) and may approve a Remote for their own branch or allow connecting to it in general — **dynamic, like Discord roles**.
3. **Expiry of an unapproved request:** the owner asked for a recommendation → **7 days** (configurable 1–30).
4. **Allocation:** counts **Players only**; Remotes are not in the allocation (today's `maxDevices` comment counts control computers and phones too — a new `maxPlayers` is proposed instead).
