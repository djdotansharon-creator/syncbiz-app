# VONO CONTROL ROOM — SYSTEM BLUEPRINT + PILOT ACCEPTANCE PLAN

> Status: **APPROVED IN PRINCIPLE — LOCKED 2026-10-06** with the owner decisions in §0.
> Architecture / product design only — nothing here is implemented by this document.
> Governing rules: `CLAUDE.md` (constitution). Current pilot state: `docs/VONO_PILOT_BASELINE.md`.
> Evidence labels follow CLAUDE.md §6. Model labels: **EXISTING / EXTEND / NEW**. Unproven claims are marked
> **HYPOTHESIS / EXPECTED**.
>
> **Design principle: POWERFUL UNDERNEATH. RIDICULOUSLY SIMPLE ON TOP.**
> Control Room sits **above** playback. It never redesigns the accepted player.

---

## 0. OWNER DECISIONS (2026-10-06) — binding for implementation

| # | Decision |
|---|---|
| D1 | **`master.designate` = OWNER / ADMIN only by default.** HQ CONTROL does NOT get it. Changing the store audio machine is a high-impact administrative action. |
| D2 | **Station onboarding = ACTIVATION CODE.** No person's username/password stays on an unattended station. The final architecture uses a **revocable station credential bound to `StationDevice`**. |
| D3 | **Each Branch has ONE primary Region + ZERO OR MORE Groups** (e.g. Region "Central"; Groups "Malls", "Flagship", "24/7"). A branch never has multiple Regions. Regional Manager scope follows the primary Region; Group scope can be used independently. |
| D4 | **Cloud connectivity and audio playback are separate dimensions.** Station: GREEN "MASTER · Playing locally" + separate AMBER "Cloud offline". Control Room on lost contact: "Connection lost · Last known: Playing <time>" — never "Playing" as current truth. RED "Store player offline / needs attention" only when the physical audio station is actually unavailable / requires action (positive evidence — §9). |
| D5 | **Missed schedule default = SKIP.** Advanced, explicitly enabled per schedule: "Play if late by up to N minutes". |
| D6 | **Immediate announcement to an offline branch default = NOW ONLY** → OFFLINE / NOT DELIVERED. Advanced, explicit per send: "Deliver when branch reconnects within N minutes". An old immediate announcement is never played later without that option. |
| D7 | **Branch Manager defaults:** YES `playback.control`, `announcement.send`, `monitoring.view`. NO `schedule.edit`, `users.manage`, `master.designate`, `campaign.manage`. OWNER/ADMIN may explicitly grant `schedule.edit`. |
| D8 | **Branches have opening hours.** "Not playing" is an actionable warning only during expected opening hours; outside them it is normal (no red / problem state). |
| D9 | **A second real TEST station is required before multi-branch acceptance** (a second real PC or isolated VM, its own durable StationDevice identity, a second TEST Branch). Not required for Gate 2. Multi-branch acceptance is never faked with two clients in one branch. |
| D10 | **PRE-PROD BLOCKERS** (must be fixed + accepted before the first real PROD pilot branch, each audited separately): **(A) long-lived station credential / self-refresh**; **(B) 24-hour recovery snapshot TTL**. A store powered off for a weekend must still zero-touch resume correctly. |
| D11 | **Phase 5 is NOT one engineering change.** Station credential, schedule sync/executor, scheduled-asset cache, INTERRUPT_ACK and STATE_UPDATE throttle/sanitize each get an isolated commit, focused audit, focused TEST acceptance and regression evidence. Only accepted changes are packaged into a cumulative beta installer. Surgical rollback is preserved. |
| D12 | **WS capacity is a HYPOTHESIS until proven** by the 300-station simulated load test (CPU, RAM, event-loop latency, reconnect waves, message throughput). |
| D13 | **Product principle:** normal users see branch name, music state, connection state, announcements, schedule, problems — NEVER UUIDs, durable ids, room keys, socket roles, leases, `legacyKey` or the internal renderer role. Advanced technical information is admin/support-only. |

---

## 1. EXECUTIVE ARCHITECTURE

```
Customer (Workspace)
 ├─ Regions (each branch has exactly ONE primary region)
 ├─ Groups (a branch may be in zero or more)
 └─ Branches
      └─ Stations (StationDevice, bound by activation code + revocable station credential)
           ├─ exactly one designated MASTER → MAIN + MPV output the store audio (LOCAL-first)
           └─ CONTROL surfaces: station renderer, browsers, phones, HQ
```

Three planes, strictly separated:

1. **Playback plane (unchanged, accepted):** MAIN + orchestrator + MPV on the station; LOCAL files; offline
   renderer cache; survives any cloud outage.
2. **Control plane:** app/API + Postgres = **management truth** (users, permissions, branches, regions/groups,
   designation, schedules, announcements, audit, durable status). WS server = **live router** (rooms, commands,
   status deltas).
3. **Station executor:** the designated MAIN executes commands, `PLAY_INTERRUPT`, and (later) locally cached
   schedules.

The cloud never streams LOCAL music and never sees LOCAL filesystem paths.

---

## 2. ENTITY HIERARCHY

| Entity | Meaning | Owns | IDs → human label |
|---|---|---|---|
| **Workspace** (EXISTING) | one customer / chain | users, branches, regions, groups, content, schedules, audit | UUID → company name |
| **Region** (NEW) | the branch's primary geography (e.g. "Central") | its branches (1:N) | UUID → name |
| **BranchGroup** (NEW) | an extra grouping (e.g. "Malls", "24/7") | memberships (N:M) | UUID → name |
| **Branch** (EXTEND) | one physical store | its stations, designation, status, opening hours, branch schedules, pads | UUID → **"Branch 014 — Dizengoff"** (`code` + `name`); `legacyKey` only for migration |
| **StationDevice** (EXISTING→EXTEND) | a physical computer running VONO | durable device id, version, binding to one branch, station credential | `dsk-…` → "Store player" (admin/support view only) |
| **BranchMasterDesignation** (EXISTING) | which station is the store audio station | one per branch | shown as the GREEN MASTER station |

- **Single-branch customer:** same model, one auto-created branch, default region, no groups. The UI hides
  regions/groups/multi-select; Control Room is just "My store".
- **300-branch chain:** branches belong to a region and optional groups; HQ works by region, group, filter or
  selection.
- **Never visible to normal users:** see D13.

---

## 3. USERS / ROLES / PERMISSIONS

Extends the existing auth (`WorkspaceMember`, `UserBranchAssignment`, `AccessType`) — no second auth system.

**Capabilities (server-enforced):** `playback.control`, `announcement.send`, `schedule.edit`, `users.manage`,
`master.designate`, `monitoring.view`, `campaign.manage`, `branches.manage`.

**Presets** (`WorkspaceMember.role` → preset; optional per-member grants/revokes stored as JSON):

| Preset | Default capabilities | Default scope |
|---|---|---|
| OWNER / ADMIN | all (incl. **`master.designate`** — D1) | all branches |
| HQ CONTROL | playback.control, announcement.send, schedule.edit, monitoring.view, campaign.manage (**no** master.designate) | all or assigned regions/groups |
| REGIONAL MANAGER | playback.control, announcement.send, schedule.edit, monitoring.view | **its primary Region** (D3) |
| BRANCH MANAGER | playback.control, announcement.send, monitoring.view (**no** schedule.edit unless granted — D7) | assigned branch(es) |
| VIEW ONLY | monitoring.view | assigned scope |

**Scope:** `UserBranchAssignment` rows of type **ALL / REGION / GROUP / BRANCH**. Effective branches = **union** of
all scope rows, resolved at request time (a new branch in a region/group is automatically covered). The member's
capability set applies across its scope.

**Administration rules:**
- invite / create users, change roles, assign scopes → `users.manage` (OWNER/ADMIN); nobody can grant a
  capability or scope they don't hold;
- change designated MASTER → `master.designate` (OWNER/ADMIN only by default — D1).

**Enforcement — ONE `authorize(user, capability, branchIds)`** used by every REST route, by token minting (WS token
carries effective branches + compact capability set) and by the WS server COMMAND check (e.g. `PLAY_INTERRUPT`
requires `announcement.send`; transport requires `playback.control`; VIEW-ONLY sockets cannot command). The UI
only hides what the server already denies. No display-only permissions.

---

## 4. MASTER / CONTROL MODEL

**Technical (unchanged, accepted):** MAIN on the designated station = MASTER; the station's embedded renderer stays
CONTROL internally; browsers/phones/HQ = CONTROL; **no automatic failover**; designation changes only by
OWNER/ADMIN.

**User-facing — two independent dimensions (D4): AUDIO and CLOUD.**

On the **designated station**:

| Audio | Cloud | Shown |
|---|---|---|
| playing | connected | 🟢 **MASTER · Playing store audio · Branch 014** |
| playing | lost | 🟢 **MASTER · Playing locally** + 🟠 **Cloud offline** |
| idle (outside hours) | any | 🟢 MASTER · Store audio station (+ 🟠 Cloud offline if lost) |
| not playing during opening hours | any | 🟢 MASTER + ⚠ "Not playing" (actionable — D8) |
| startup (MAIN not reported yet) | — | nothing for a moment (no wrong badge) — accepted behavior |

On **other devices (CONTROL)**:

| Situation | Shown |
|---|---|
| master reachable | 🔵 **CONTROL · Controlling Branch 014 · Store player online** |
| master not reachable from the cloud | 🔵 CONTROL · Branch 014 · 🟠 **Connection lost · Last known: Playing 09:12** |
| master positively unavailable (§9) | 🔵 CONTROL · Branch 014 · 🔴 **Store player needs attention** |
| this control device disconnected | ⚪ "Reconnecting…" (automatic) |

Colors: 🟢 healthy / master, 🔵 control, 🟠 degraded-but-not-proven-down, 🔴 only actionable failure (D4, D13).

---

## 5. CONTROL ROOM UX (HOME)

**Top strip (big, clickable filters):**
> **300** Branches · 🟢 **287** Connected · 🟠 **10** Connection lost · 🔴 **3** Need attention · 🎵 **281** Playing ·
> ⏸ **6** Not playing (during opening hours)

**Default view = branch cards** (list toggle for big screens). Each card shows only:
- **Branch 014 — Dizengoff** · region tag (+ group tags, subtle)
- one status line:
  - 🎵 Playing "Morning Café"
  - ⏸ Closed (outside opening hours — neutral, no warning)
  - ⚠ Not playing (during opening hours)
  - 🟠 Connection lost · last known: Playing 09:12
  - 🔴 Store player needs attention
- ⚠ issue icon only when actionable (outdated app, last announcement failed, clock skew).

Behind "Details" / admin only: app version, last seen, station identity, uptime, technical info (D13).

- **Filters:** Region · Group · Status (All · **Problems only** · Connection lost · Not playing · Closed).
- **Search:** branch code or name.
- **Multi-select:** checkboxes, "Select region", "Select group", "Select filtered".
- **Action bar** (with a selection): **📢 Announce** · **🎵 Change music** (later) · **📅 Schedule**.
- "Problems only" is one tap and is the recommended morning view.

---

## 6. BRANCH DETAIL UX

Five tabs, one obvious action each:

1. **Overview** — music state + connection state (separately, D4), now playing / last known, today's upcoming
   announcements, opening hours today, last 5 events.
2. **Music** — what's playing; Play/Pause/Next/volume (existing CONTROL commands); choose playlist.
3. **Jingles** — pads + library; **Preview** (local only) and **📡 On-Air** (to this branch) — accepted model.
4. **Schedule** — this branch's week (§8 / §8a).
5. **Devices** (admin/support) — the store player (version, last seen), connected control devices, opening hours
   settings, "Replace store player" wizard (§12).

---

## 7. MULTI-BRANCH ANNOUNCEMENTS

Flow (no new playback path):
1. Pick or create an announcement → generated **once** (ElevenLabs) → one stored asset reused for every target.
2. Choose targets: branch(es) / region / group / "all my branches".
3. Confirm summary ("Send to 47 branches now").
4. `POST /api/announce` → `authorize(announcement.send, targets)` → server expands targets to branches → one
   `AnnouncementDelivery` per branch.
5. App → WS internal fan-out (secret-gated, like designation sync) → for each branch room → the **existing**
   `COMMAND PLAY_INTERRUPT {url, preRoll, bellStyle}` to the designated MAIN.
6. MAIN → `orchestrator.playInterrupt` → MPV (duck → play → restore) — unchanged, accepted.

**Delivery states:** `pending` → `sent` (handed to the MAIN socket) → `acknowledged` (MAIN confirms start —
requires the INTERRUPT_ACK gate) · `offline` / `not delivered` (MAIN not connected at send time) · `failed`
(rejected / invalid) · `expired` (only with the reconnect option, after N minutes).

**Offline default (D6): NOW ONLY.** An offline branch is marked OFFLINE / NOT DELIVERED. Advanced explicit option
per send: "Deliver when the branch reconnects within N minutes" (MAIN reconnect triggers delivery until expiry).
An immediate announcement is never played later without that option. Scheduled announcements don't need this —
they execute locally (§8).

---

## 8. CENTRAL SCHEDULING

- **Source of truth = server/DB. Executor = the designated MAIN only.** Browsers and phones never execute
  (today's browser jingle scheduler and browser music `ScheduleAutoPlayer` are retired in their phases).
- **Model (NEW `AnnouncementSchedule`):** content (announcement asset), target (branch / region / group, expanded
  per branch at sync), local time of day, recurrence (once / weekly days / daily), optional date window, enabled,
  `lateGraceMin` (default **null = SKIP**, D5), `revision`.
- **Timezone:** owned by the **Branch** (`Branch.timezone`, EXISTING). "09:00" = 09:00 local per branch.
- **Sync:** on MAIN connect and on change, server pushes `SCHEDULE_SYNC {branch, revision, items}` → MAIN stores it
  atomically in ProgramData → **pre-downloads referenced MP3s to a local cache** → acknowledges the revision.
- **Execution:** MAIN local timer (local clock) → `playInterrupt` from the **local cached asset** → works offline.
  Fire log kept locally, uploaded on reconnect.
- **Missed events (D5):** station off at the time → **SKIP**. Only if "Play if late by up to N minutes" is
  explicitly enabled on that schedule, a late fire within N minutes plays once.
- **Conflicts:** same minute → queued in order (the interrupt queue already serializes); the editor warns on exact
  overlap; nothing is silently merged.
- **Clock:** Windows NTP assumed; MAIN reports clock skew in its heartbeat; large skew = Control Room warning.
- **Revisions:** each edit bumps `revision`; MAIN applies only newer; history in the audit log.
- **Music schedules (later phase):** existing `Schedule` rows, same model (server truth + MAIN executor). Kept
  separate from announcements: announcements *interrupt*, music schedules *replace*.

### 8a. SIMPLE SCHEDULE UX
Week grid (7 day columns, hour rows). Announcements = small cards (icon + title); music = wide colored blocks with
cover art. Create: tap a slot → **What?** (big cards) → **Which days?** (7 big toggles + "Every day") → **What
time?** (large picker) → **Save**. "More options" (collapsed): date range, "Play if late by up to N minutes",
target region/group. No cron, no timezone fields, no technical wording.

---

## 9. STATUS / HEARTBEAT (two dimensions — D4)

**Per branch, stored separately:**
- **Connection:** `connected` / `connection_lost` (since t) — cloud's view of the MAIN socket.
- **Audio (last known):** `playing` / `not_playing` / `unknown`, with `lastKnownAt` — only *current* while
  connected; once connection is lost it is shown strictly as "Last known: … at <time>".
- **Needs attention (RED) — only on positive evidence**, e.g.:
  - MAIN connected and reports engine failure / not playing during opening hours with no recovery for N minutes;
  - watchdog / MAIN incident reported that the station could not recover;
  - after reconnect the station reports it was down (back-filled as an incident);
  - an admin-defined escalation: connection lost **during opening hours** for longer than a configurable
    threshold shows as escalated 🟠 "Connection lost for 2h — please check the store" (still not claiming the
    audio stopped).
- **Not playing outside opening hours** = neutral "Closed" (D8).

**In WS memory:** live sockets, rooms, last `STATE_UPDATE` per room, computed live status.
**Persisted (NEW `BranchStatus`, one row per branch):** connection state + since, last-known audio state + time,
safe now-playing title (never paths), app version, clock skew, `lastSeenAt`.
**Writes:** change-driven only (connection change, audio change, title/source change, version change) + **one
batched heartbeat per minute** (WS server → internal app endpoint with all "seen" stations → one SQL update).
No MPV event is ever written to Postgres.
**Thresholds:** MAIN socket closed → `connection_lost` immediately; WS server itself down → app marks all `stale`
after 3 missed batches; opening-hours "not playing" warning after 10 min (configurable).
**HQ subscription:** REST snapshot from `BranchStatus` on load (covers offline / never-seen branches) + WS
`BRANCH_STATUS` deltas coalesced to ≤1/s per branch; full `STATE_UPDATE` only for the branch whose detail is open.
**STATE_UPDATE flood (confirmed: MAIN sends on every MPV event):** server-side coalesce + dedupe fan-out first (no
installer); MAIN-side throttle + sanitize later as its own isolated gate (§16 Phase 5d).

---

## 10. OFFLINE / FAILURE MODEL

| Case | Music | Schedules (§8 model) | HQ control | Control Room shows | Auto-recovers | Intervention |
|---|---|---|---|---|---|---|
| A. one branch internet out | ✅ continues (proven) | ✅ local | ❌ for that branch | 🟠 Connection lost · last known Playing <t> (station: 🟢 Playing locally + 🟠 Cloud offline) | ✅ MAIN + renderer reconnect (proven) | no |
| B. WS restart | ✅ (proven) | ✅ | brief gap | briefly 🟠 for all, then back | ✅ (proven; state persisted) | no |
| C. app server restart | ✅ | ✅ | API gap; WS commands work | stale snapshot banner | ✅ | no |
| D. Postgres down | ✅ | ✅ | WS commands work; management / new announcements don't | "Data temporarily unavailable" | ✅ | ops |
| E. HQ browser closes | ✅ | ✅ | n/a | n/a | — | no |
| F. renderer crash / reload | ✅ (MPV in MAIN; live adopt) | ✅ | ✅ via MAIN | unchanged | ✅ | no |
| G. MAIN crash | ⚠ stops until watchdog relaunch, then resumes | resumes after relaunch | ❌ briefly | 🟠 then 🟢; incident reported → visible in history | ✅ watchdog (accepted) | no |
| H. MPV crash | ⚠ brief; self-heal | ✅ | ✅ | maybe short ⚠ | ✅ | no |
| I. Windows reboot | resumes (accepted with/without internet) | ✅ after start | ✅ after reconnect | 🟠 then 🟢 | ✅ | no — **>24h off: pre-prod blocker B** |
| J. scheduled announcement while offline | ✅ | ✅ **plays from local cache** | — | fire log appears on reconnect | ✅ | no |
| K. MASTER physically dead | ❌ no audio (no failover, by design) | ❌ | ❌ | 🟠 Connection lost → escalated during opening hours; 🔴 once evidence/confirmation (e.g. station reports or support confirms) + **"Replace store player"** | ❌ | **yes**: replace / redesignate (§12) |
| L. CONTROL device offline | ✅ | ✅ | from other devices | that device missing | ✅ | no |
| M. a whole region loses internet | ✅ each branch | ✅ | ❌ for the region | region shows 🟠 Connection lost (last known states kept) | ✅ when back | no |

Row J requires the schedule executor gates (§16 Phase 5b/5c).

---

## 11. ZERO-TOUCH MODEL

POWER → Windows → VONO (auto-start + Protection watchdog) → durable identity (ProgramData) → **station credential**
→ cached designation → offline-capable renderer → LOCAL restore → MPV → schedules from local cache → cloud
reconnect (MAIN + renderer, automatic) → heartbeat / control.

Must self-recover: network, WS, app server, renderer, MAIN/MPV crash, reboot.

**PRE-PROD BLOCKERS (D10) — each audited separately before implementation, accepted before the first real PROD
pilot branch:**
- **A. Long-lived station credential / self-refresh.** Station auth must not depend on any person's web session
  (today the desktop token is renewed via a browser session). Revocable credential bound to `StationDevice`,
  self-refreshing, issued by activation code (D2).
- **B. 24-hour recovery snapshot TTL.** A store powered off over a weekend must still zero-touch resume correctly.
  (Lives in the playback provider → sensitive area → audit first.)

---

## 12. BRANCH INSTALLATION / REPLACEMENT

**New branch:** Admin creates **Branch 014 — Dizengoff** (region Central, groups, opening hours) → system shows an
**activation code** → installer tech installs VONO, enters the code → station binds to Branch 014 (`StationDevice`
+ station credential) → first station: "Make this the store player?" → **OWNER/ADMIN confirms designation** → pick
default playlist (+ optional "Keep offline") → Control Room shows 🟢 Playing → done. For 50–300: CSV import of
branches/regions/groups/opening hours + printable activation-code sheet.

**Replacement (dead station):** install VONO on the new PC with the branch activation code → OWNER/ADMIN: Branch →
Devices → "Replace store player" → designation moves to the new station → the **old station is revoked** (existing
accepted revoke path: `designated:false` → stops audio) and its credential revoked → audited. If the old station
returns later it registers as CONTROL, cannot steal MASTER, its local designation cache is cleared, and the admin
sees it as "spare". A second computer at a branch joins as CONTROL, never automatic MASTER. Branch users cannot do
any of this.

---

## 13. SCALING TO 300

Expected load: ~600 station sockets (MAIN + renderer) + phones + HQ.
**Capacity of one Node WS process for 600–900 sockets = HYPOTHESIS / EXPECTED (D12)** — accepted only when the
300-station simulated load test proves CPU, RAM, event-loop latency, reconnect-wave behavior and message throughput.

**MUST before 300 (most before 50):**
1. STATE_UPDATE: server-side coalesce + dedupe; MAIN throttle + sanitize (isolated gate).
2. `DEVICE_LIST` broadcast only to the **affected room** (today: every register/disconnect → all rooms ⇒ O(N²)
   reconnect waves).
3. HQ: `BRANCH_STATUS` deltas + per-branch detail subscription instead of all `STATE_UPDATE` streams.
4. WS state persistence (✅ volume, proven) and reconnect jitter (✅ MAIN + renderer).
5. The 300-station load test (acceptance evidence).

**CAN WAIT:** multiple WS instances (sticky rooms / shared pub-sub), WS high availability, moving the jingle volume
to R2 / `MediaAsset`.

---

## 14. SECURITY

- **Workspace isolation:** workspace only from signed tokens (EXISTING). **Branch isolation:** room = workspace +
  canonical branch.
- **One `authorize()`** for all REST; WS COMMANDs checked against token capabilities; announce / schedule /
  designate are REST-only with `authorize` + audit.
- **Designation:** `master.designate` (OWNER/ADMIN) + audit + server-side revoke of the old station.
- **Token scopes:** short-lived browser tokens; revocable station credential (D2); HQ fan-out app → WS via the
  internal secret (never from the browser).
- **No LOCAL paths in the cloud:** existing stripping + MAIN-side state sanitize (gate 5d).
- **Secrets:** ElevenLabs key server-only; `/api/jingles/audio/<uuid>` is UUID-only (acceptable for pilot; signed
  URLs later); never put secrets in docs/memory/committed files.
- **Audit** everything administrative (§15a).

### 15a. AUDIT LOG (`AuditLog`, EXISTING)
Record: announcement sent (who, content, targets, result summary) + per-branch `AnnouncementDelivery`; schedule
create/edit/delete/enable; user/role/scope changes; MASTER designation / revocation; branch / region / group create
& edit; opening-hours changes; station bind / replace / revoke; HQ playlist changes and other major remote actions.
**Not logged:** play/pause ticks, positions, MPV events, heartbeats.

---

## 15. COST DRIVERS (300 branches)

| Driver | Level | Note |
|---|---|---|
| WS server | small *after* the STATE_UPDATE fix | today's flood is the main scale risk; capacity = hypothesis until load test |
| App/API + hosted renderer | moderate | every station runs the web app; activation / polling calls |
| Postgres | small | change-only writes + 1 batched heartbeat/min |
| Jingle storage / bandwidth | small | ~35–500 KB per MP3, one per branch per send; cached for schedules |
| ElevenLabs | moderate (usage) | generate once per announcement, never per branch |
| Music Bank (if used) | **potential scale concern** | streams through VONO storage; LOCAL music never does |
| Logs / telemetry | small → moderate | incidents only |
| Object storage (future R2) | small | content-addressed |
| Single Railway volume | scale constraint | limits horizontal app scaling; solved by R2 later |

---

## 16. DATA MODEL (minimal)

| Entity | Status | Change |
|---|---|---|
| Workspace | EXISTING | — |
| WorkspaceMember | EXTEND | role = preset; `capabilityGrants Json?` (explicit grants/revokes, e.g. `schedule.edit` for a Branch Manager) |
| UserBranchAssignment | EXTEND | `scopeType` ALL / REGION / GROUP / BRANCH; `regionId?`, `groupId?`, `branchId?` |
| **Region** | NEW | `id, workspaceId, name, code?` |
| Branch | EXTEND | `regionId` (exactly one primary region — D3); `code` = branch number; `openingHours Json` (D8); `legacyKey` (done); `timezone` (EXISTING) |
| **BranchGroup** | NEW | `id, workspaceId, name` (additional groups only — regions are NOT groups) |
| **BranchGroupMember** | NEW | `branchId, groupId` (N:M) |
| StationDevice | EXTEND | station credential hash, `status` active / spare / revoked, `revokedAt`, activation metadata |
| **StationActivationCode** | NEW | `code (hashed), workspaceId, branchId, expiresAt, usedAt, createdBy` |
| BranchMasterDesignation | EXISTING | `branchId` → canonical id (Gate 2 data migration) |
| Schedule (music) | EXISTING | executor moves to MAIN in a later phase |
| Announcement | EXISTING | the asset row; `branchId` → canonical or workspace-level |
| **AnnouncementSchedule** | NEW | `announcementId`, target (branch/region/group), `timeLocal`, `daysOfWeek`, `oneOffDate`, `startDate/endDate`, `lateGraceMin` (null = SKIP), `enabled`, `revision` |
| **AnnouncementSend** | NEW | one per HQ send: who, content, targets, `deliverOnReconnectMin` (null = NOW ONLY) |
| **AnnouncementDelivery** | NEW | `sendId` or schedule run, `branchId`, `state`, timestamps, error |
| **BranchStatus** | NEW | connection state + since, last-known audio state + time, safe title, app version, clock skew, lastSeenAt |
| AuditLog | EXISTING | more action types |
| JinglePadAssignment | EXISTING | `branchId` → canonical |
| Device (legacy) | EXISTING | untouched; retire later |

---

## 17. API / WS RESPONSIBILITIES (high level)

**Management / control plane**
- **REST (app):** auth + tokens; station activation (code → credential) + credential refresh; users / roles /
  scopes; regions / groups / branches (+ opening hours, CSV import); stations: bind / replace / designate / revoke;
  announcements (create, generate once); `/announce` (fan-out + delivery); schedules CRUD; Control Room status
  snapshot; audit; internal endpoints for the WS server (batched heartbeat, status changes).
- **WS (live router):** REGISTER into canonical rooms; room-scoped `DEVICE_LIST`; capability-checked COMMANDs;
  `BRANCH_STATUS` deltas to HQ; per-branch `STATE_UPDATE` subscription; internal endpoints: designation (EXISTING),
  branch-alias (EXISTING), announce fan-out (NEW), schedule-changed notify (NEW).

**Playback execution (station)**
- MAIN receives `PLAY_SOURCE` / transport / `PLAY_INTERRUPT` (EXISTING); NEW `SCHEDULE_SYNC`, `INTERRUPT_ACK`;
  throttled + sanitized `STATE_UPDATE`. MPV / orchestrator unchanged.

---

## 18. IMPLEMENTATION PHASES

Order: canonical branches first (everything downstream keys on them). Every gate: audit → approval → isolated
commit(s) → focused tests + regression matrix → TEST deploy → runtime acceptance → baseline update.

| Phase | Goal | DB | Server | Renderer | Installer | Playback risk | TEST gate | Rollback |
|---|---|---|---|---|---|---|---|---|
| **0 / Gate 1** ✅ | shadow canonical branch | done | done | — | no | none | ACCEPTED | done |
| **1 / Gate 2** | activate canonical branch on TEST (single branch): migrate `"default"` rows; alias active; station room from its signed station binding; renderer joins its station's branch | reversible data migration | WS + token mint | yes | **no** | low–medium (routing) | Lenovo MASTER + renderer CONTROL in canonical room; LOCAL / On-Air / reconnect / offline-boot regression | DB backup + WS files + alias back to shadow |
| **2** | permissions core: presets, capabilities (D1, D7), scopes ALL/REGION/GROUP/BRANCH, Region + Groups (D3), `authorize()` in REST + token claims + WS COMMAND checks | additive | app + WS | minimal | no | none | a TEST user per preset; denials enforced via API and WS | migration down + revert |
| **3** | durable two-dimension status (D4) + opening hours (D8) + read-only Control Room home + Overview; WS hygiene (room-scoped `DEVICE_LIST`, HQ deltas, server-side STATE_UPDATE coalesce); branch label in badges; station 🟠 "Cloud offline" | `BranchStatus`, `openingHours` | app + WS | yes | no | low | status truth vs reality incl. connection-lost vs playing; **300-station load test** (D12) | revert |
| **4** | multi-branch announcements (NOW ONLY default, optional reconnect window — D6) on existing `PLAY_INTERRUPT`; delivery states up to `sent` | Send / Delivery | app + WS fan-out | yes | no | low | 1 real branch (+ simulated); heard on Lenovo; offline → not delivered | revert |
| **5a** | **station activation code + station credential / self-refresh** (pre-prod blocker A) | ActivationCode, StationDevice ext. | app + WS auth | small | yes (isolated) | medium | activation on a clean PC; credential survives weeks (accelerated expiry test); revoke works | previous installer |
| **5b** | MAIN `SCHEDULE_SYNC` + local executor (D5 SKIP default) | AnnouncementSchedule | app + WS | — | yes (isolated) | medium | fires at branch time online + offline; revision sync; missed → skip | previous installer |
| **5c** | scheduled-asset local cache | — | — | — | yes (isolated) | low–medium | offline fire uses cached MP3; cache eviction safe | previous installer |
| **5d** | MAIN STATE_UPDATE throttle + sanitize | — | — | — | yes (isolated) | **medium (MAIN WS)** | full playback matrix; mirrors still correct; no local paths on the wire | previous installer |
| **5e** | INTERRUPT_ACK | — | WS + app | — | yes (isolated) | low | delivery reaches `acknowledged` | previous installer |
| **5-PKG** | package the individually ACCEPTED 5a–5e into one cumulative TEST beta (D11) | — | — | — | yes | — | full regression + installer upgrade/rollback | previous accepted installer |
| **6** | central schedule UX (week grid, §8a); retire browser jingle scheduler | — | app | yes | no (uses 5b/5c) | low | non-technical create → fires on Lenovo, incl. offline | revert |
| **7** | users/roles UI, branch create / CSV / opening hours, install + replace wizards, audit views | — | app | yes | no | low | non-technical walkthrough per flow | revert |
| **B (pre-prod)** | **24h recovery snapshot TTL** (pre-prod blocker B) — own audit (playback provider = sensitive) | — | — | yes | no | **sensitive** | weekend-off (≥48h powered off) zero-touch resume on Lenovo | revert |
| **8** (later) | music schedules → MAIN executor; campaigns | — | app + WS | yes | maybe | medium | own gate | — |
| **PROD** | repeat migrations for PROD (separate approval, backups) | — | — | — | PROD installer | — | per §20 | PROD backups |

Multi-branch acceptance (Phase 3/4 multi-branch rows, §19 MULTI-BRANCH) requires the **second real TEST station +
second TEST Branch** (D9). Gate 2 does not.

---

## 19. PILOT ACCEPTANCE MATRIX

Evidence: **R** = owner runtime on the Lenovo (real audio); **S** = server logs / DB; **T** = automated tests;
**L** = load-test report.

| Group | Scenario | Expected | Evidence |
|---|---|---|---|
| IDENTITY / MASTER | canonical activation | Lenovo MASTER, renderer CONTROL, same canonical room | S + R |
| | second station joins same branch | CONTROL; cannot steal MASTER | S |
| | replace store player | new MASTER; old revoked + stops; later rejoins as CONTROL "spare" | S + R |
| | non-admin tries to designate | denied (API + WS) | T + S |
| PLAYBACK | DO-NOT-REGRESS list (LOCAL, URL, handoffs, SEEK, AUTOMIX, NEXT crossfade, heavy load) | unchanged | R + T |
| OFFLINE | internet out 30+ min | music + local schedules continue; station 🟢 Playing locally + 🟠 Cloud offline; HQ 🟠 Connection lost · last known | R + S |
| | reboot without internet | resumes | R |
| | **powered off ≥ 48h, then on** (blocker B) | zero-touch resume | R |
| CONTROL ROOM | counters vs reality; Problems-only; Closed outside opening hours is neutral | correct within 60s; no false red | S + R |
| PERMISSIONS | every preset × allowed/denied action, via API and WS; Branch Manager schedule.edit only when granted | server denies | T + S |
| ANNOUNCEMENTS | send to 1 / region / group / all | heard; delivery `sent`/`acknowledged` | R + S |
| | send to offline branch (default) | `offline` / not delivered; never plays later | S + R |
| | send with reconnect window N | plays on reconnect within N, else `expired` | S + R |
| SCHEDULES | weekly item at branch time | plays | R |
| | offline at fire time | plays from local cache | R + S |
| | station off at fire time (default) | skipped | S |
| | "play if late by N" enabled | plays once within N | R + S |
| | edit → new revision | applied by MAIN | S |
| MULTI-BRANCH (needs D9) | 2 real stations in 2 TEST branches | commands isolated; region/group send reaches only its targets | R + S |
| MONITORING | kill MAIN | connection lost within ~5s; incident visible after recovery | S |
| | WS server down | all `stale` after 3 batches; recovers | S |
| RECOVERY | WS / app / DB restart; MAIN / MPV kill; renderer reload | auto-recover, no audio stop (except MAIN-kill gap) | R + S |
| STATION CREDENTIAL (blocker A) | activation code on clean PC; long idle; revoke | binds; self-refreshes; revoked station loses control | S + R |
| SCALE / LOAD | 300 simulated stations + 3 restart waves | CPU / RAM / event-loop / throughput within limits; real Lenovo unaffected | L + S |
| UPGRADE / ROLLBACK | install new beta over current while playing; roll back | zero-touch upgrade; rollback works | R |

---

## 20. ROLLOUT PLAN

- **TEST:** all matrix rows pass; pre-prod blockers A + B accepted; baseline + tags locked.
- **1 pilot branch (PROD):** PROD migrations with backups (explicit approval) → the Lenovo as the first real branch
  → **7 days unattended**, zero interventions, daily Control Room check.
- **5 branches:** activation codes, a replacement drill, a region announcement, a schedule week → 7 clean days.
- **50:** load-test evidence (300 simulated), support runbook, stable dashboard → 14 clean days.
- **100 → 300:** staged batches of 50, each after 7 clean days. Any P0 freezes rollout.

---

## 21. BASELINE / ROLLBACK POLICY

- Preserve all accepted `pilot-baseline/*` tags, installer binaries + SHA256, PR #52 frozen.
- **Before every DB migration:** verified `pg_dump` + restore check (as Gate 1) + WS state files; additive
  migrations; reversible data scripts where practical.
- **TEST first, always.** PROD only with explicit approval, per phase.
- **New Control Room baseline tag** (`pilot-baseline/<date>-control-room-<phase>`) after each phase's TEST
  acceptance; installer phases additionally preserve the binary backup. Isolated gates (5a–5e) are accepted
  individually before packaging (D11).

---

## 22. OPEN ITEMS (non-blocking for Gate 2)

- Opening-hours UX details (per weekday + exceptions/holidays).
- Escalation threshold for "Connection lost during opening hours" (default proposal: 2h).
- Music schedules migration timing (Phase 8).
- Signed jingle URLs (post-pilot).
