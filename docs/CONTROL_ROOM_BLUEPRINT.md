# VONO CONTROL ROOM — SYSTEM BLUEPRINT + PILOT ACCEPTANCE PLAN

> Status: **APPROVED IN PRINCIPLE — LOCKED 2026-10-06** with the owner decisions in §0.
> **AMENDED 2026-10-07 — MULTI-BRAND + MULTI-ZONE ARCHITECTURE LOCKED (D14–D22, §2, §2a–§2f, §23).**
> **D18 FINAL (lifecycle rule) LOCKED 2026-10-07** — at most one designated MASTER per Zone; provisioned zones exactly
> one; unprovisioned zones may have zero. **CLAUDE.md §11 amended accordingly (applied 2026-10-07, §24).**
> WS room format for additional zones: **DEFERRED** to the Zone Foundation Gate audit.
> All future Control Room work is designed around **Organization → Brand → Location → Zone → Station**.
> Architecture / product design only — nothing here is implemented by this document (no code, no migration).
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

### Amendment 2026-10-07 — MULTI-BRAND + MULTI-ZONE (binding for all future Control Room design)

| # | Decision |
|---|---|
| D14 | **Hierarchy = Organization → Brand → Location → Zone → Station.** ONE ORGANIZATION · MULTIPLE BRANDS · MULTIPLE LOCATIONS · MULTIPLE AUDIO ZONES · ONE CONTROL ROOM. Target verticals: retail chains, multi-brand groups, hotels, gyms, restaurants, resorts, shopping centers. |
| D15 | **Brand is a real first-class entity** under the Organization (not a tag, not a group, not a separate workspace). The entire Control Room can be filtered by Brand. A single-brand customer gets one auto-created brand that the UI hides. |
| D16 | **Zone is a real physical audio destination** inside a Location (Lobby, Pool, Spa, Restaurant, Gym, Rooftop, Main Store). A Location has **one or many** zones; every Location always has at least one (auto-created default zone, hidden in the UI while it is the only one). |
| D17 | **Region / Group / Tags are classification / filtering dimensions — NEVER zones.** Region = geography (exactly one primary per Location, D3 unchanged); Group = managed classification (zero or more, e.g. Mall / Street / Outlet / Flagship); Tags = lightweight labels (zero or more, e.g. 24/7, Premium, Kosher, Seasonal). |
| D18 | **FINAL, LOCKED 2026-10-07. Zone is the playback-authority unit.** **At most one designated MASTER per Zone at all times. Every active / provisioned playback Zone must have exactly one designated MASTER. An unprovisioned Zone may temporarily have zero designated MASTERs.** **PROVISIONED ZONE:** a Zone with an activated / bound Station intended to provide playback. **UNPROVISIONED ZONE:** a configured Zone that does not yet have an active designated playback Station. Rules: max MASTERs per Zone = 1 · provisioned Zone = exactly 1 · unprovisioned Zone = 0 allowed · never automatic failover · a Zone may contain multiple StationDevice records; non-designated stations remain CONTROL / service / standby · standby promotion only by explicit audited admin action · no station may steal MASTER on reconnect / reboot / order of startup. A Location with a single zone uses a **default Zone** (hidden in normal UI) that preserves today's pilot behavior **exactly**. *(Applied to CLAUDE.md §11 — §24.)* |
| D18a | **LOCKED. Zones are the final playback destination.** Future playback commands, status, announcements, schedules and campaigns **target Zones**; nothing new may assume Branch/Location is the final playback destination. A Location-level target is expanded to its zones. |
| D19 | **Every Control Room surface respects the active filter** — top metrics, map, location list, alerts, campaigns, announcements, schedules. |
| D20 | **Content / policy inheritance is designed for (not built):** Organization default → Brand default → Location override → Zone override, for music, playlists, schedules, announcements, campaigns, opening hours, permissions/policies. |
| D21 | **Permission scopes must express:** HQ Admin (all) · Brand Manager (one or more brands) · Regional Manager (**brand + region**) · Location Manager (one location) · Zone operator (specific zones, if enabled later). |
| D22 | **Onboarding is bulk-import first:** Brand, location code, location name, region, group(s), address, zones → then activation per Location/Zone → station activation code → physical VONO player. Technicians never reconstruct the hierarchy by hand. |

---

## 1. EXECUTIVE ARCHITECTURE

```
Organization  (= Workspace)                         ← one customer / company / network
 ├─ classification dimensions (organization-wide, cross-brand — FILTERS, never audio destinations)
 │    ├─ Regions   (each Location has exactly ONE primary region)
 │    ├─ Groups    (a Location may be in zero or more)
 │    └─ Tags      (zero or more lightweight labels)
 └─ Brands                                          ← first-class (Golf · Golf & Co · Hotel Brand A)
      └─ Locations (= Branch / Property)            ← physical site (Golf & Co – Ayalon Mall · Hotel Tel Aviv)
           └─ Zones                                 ← physical AUDIO destination (Lobby · Pool · Spa · Main Store)
                └─ Stations (StationDevice, bound by activation code + revocable station credential)
                     ├─ at most one designated MASTER PER ZONE (exactly one once provisioned) → MAIN + MPV output that zone's audio
                     └─ CONTROL surfaces: station renderer, browsers, phones, HQ
```

A single-brand, single-location, single-zone customer is the same model with one auto-created brand, location and
zone — the UI hides every level that has only one member ("My store").

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

**Structural hierarchy (ownership — each level belongs to exactly one parent):**

| Level | Entity (code name) | Status | Meaning | Owns | Human label |
|---|---|---|---|---|---|
| 1 | **Organization** (`Workspace`) | EXISTING | the customer / company / network (e.g. Golf Group, a hotel group) | users, brands, regions, groups, tags, content library, org defaults, audit | company name |
| 2 | **Brand** (`Brand`) | **NEW** | a real brand under the organization (Golf · Golf & Co · Hotel Brand A) | its locations; brand defaults (content / policy / identity) | brand name + optional logo/color |
| 3 | **Location** (`Branch`, kept as table name) | EXISTING → EXTEND | the physical site (Golf & Co – Ayalon Mall · Hotel Tel Aviv) | its zones; timezone, address, opening hours, region/group/tag classification | **"014 — Ayalon Mall"** (`code` + `name`); UI noun per vertical: Store / Branch / Property / Club |
| 4 | **Zone** (`Zone`) | **NEW** | a physical audio area inside the location (Lobby · Pool · Spa · Restaurant · Gym · Rooftop · Main Store) | its station(s), MASTER designation, live/durable status, zone overrides | "Pool" (hidden when the location has a single default zone) |
| 5 | **Station** (`StationDevice`) | EXISTING → EXTEND | a physical VONO player; a zone has zero or more — at most one is the designated MASTER (exactly one once the zone is provisioned) | durable device id, version, credential, binding to ONE zone | "Store player" / "Pool player" (admin/support detail only) |
| — | **Designation** (`BranchMasterDesignation`) | EXISTING → EXTEND | which station is the zone's audio authority | one per **zone** (today: one per branch = its single zone) | GREEN MASTER |

**Classification dimensions (filters, NOT structure, NOT audio destinations — D17):**

| Dimension | Status | Cardinality per Location | Examples | Defined at |
|---|---|---|---|---|
| **Region** | NEW | exactly one (D3) | North / Center / South | Organization (shared across brands, so "Golf & Co + Center" is a filter intersection) |
| **Group** | NEW | zero or more | Mall / Street / Outlet / Flagship | Organization (managed list) |
| **Tags** | NEW | zero or more | 24/7 · Premium · Kosher · Seasonal | Organization (free-form, normalized lowercase key + display label) |
| **Zone type** | NEW | one per Zone | LOBBY · POOL · SPA · RESTAURANT · GYM · ROOFTOP · MAIN_STORE · OTHER | Organization-wide controlled vocabulary (lets "All Spa zones" work across properties even if one is named "Wellness Spa") |

- **Never visible to normal users:** see D13. Default brand / default zone are invisible while they are the only one.
- **Rule of thumb:** if it *plays audio* it is a **Zone**; if it *describes or selects* locations it is a
  Region / Group / Tag.

### 2a. ZONE = PLAYBACK-AUTHORITY UNIT (D18)

- **D18 lifecycle rule (LOCKED):** *At most one designated MASTER per Zone at all times. Every active / provisioned playback Zone must have exactly one designated MASTER. An unprovisioned Zone may temporarily have zero designated MASTERs.*
  - **PROVISIONED ZONE** — a Zone with an activated / bound Station intended to provide playback → exactly 1 MASTER.
  - **UNPROVISIONED ZONE** — a configured Zone that does not yet have an active designated playback Station → 0 allowed;
    shown as **⚙ Setup required** (§9). No fake StationDevice or fake MASTER record is ever created to fill it.
  - Max MASTERs per Zone = **1**, always.
- Each provisioned zone is an independent audio stream with its own queue, volume, schedule execution,
  jingles/announcements and status. A hotel with Lobby + Pool + Spa (all provisioned) = three MASTERs.
- **A zone may contain multiple StationDevice records.** At most one is designated MASTER; the others are CONTROL /
  service / future-standby devices bound to the same zone. They are visible to admin/support ("spare"), can be
  promoted **only** by an explicit admin designation change (D1, audited), and **never** auto-steal or auto-inherit
  MASTER — not on reconnect, not when the MASTER is offline, not on reboot order. "Future standby" means a
  pre-installed device an admin can switch to with one action — **not** automatic failover.
- All permanent-MASTER rules (CLAUDE.md §11) apply per zone: no failover, reconnect never elects, another station
  can't steal, browser/phone never MASTER, designation only by explicit admin action.
- **Default zone = backward compatibility (LOCKED).** Every Location has a default zone (created / backfilled), hidden
  in normal UI while it is the only zone. The existing single-branch MASTER semantics map to it **1:1**: today's
  `BranchMasterDesignation` row, `StationDevice` binding, signed token claim, canonical WS room, pads and
  announcement/schedule rows all resolve to the default zone. The accepted pilot behavior (Lenovo MASTER, renderer
  CONTROL, offline boot, reconnect, LOCAL/URL playback) must remain **byte-for-byte unchanged** — this is an
  acceptance criterion of the zone gate.
- **Zones are the final playback destination (D18a).** New status, commands, announcements and schedules target
  zones; a Location target is expanded to its zones.
- **Live routing:** the **default zone keeps today's canonical branch room behavior** (`ws:<workspace>:<branch>`) —
  backward compatible, LOCKED. The room format for **additional zones is DEFERRED** to the Zone Foundation Gate audit
  (no multi-zone room format is locked here).
- Station : Zone = N : 1 (one zone, zero or more stations, at most one MASTER; exactly one once provisioned). One PC driving several zones via
  several audio outputs is a **HYPOTHESIS / later** (would need one MAIN orchestrator per output); not designed in.
- Location-level views aggregate their zones (e.g. "3 zones · 2 playing · 1 connection lost").

### 2b. CONTROL ROOM FILTERING (D19)

The active filter is one expression over the hierarchy + dimensions:
`brands ∧ regions ∧ groups ∧ tags ∧ locations ∧ zoneTypes ∧ zones` (each optional; values inside one dimension are OR-ed).

| Example | Filter |
|---|---|
| All Brands | (empty) |
| Golf & Co only | brands = {Golf & Co} |
| Golf & Co + Center | brands = {Golf & Co} ∧ regions = {Center} |
| All Hotels | brands = {all hotel brands} (or a Group "Hotels") |
| One Property | locations = {Hotel Tel Aviv} |
| All Spa zones | zoneTypes = {SPA} |
| All Lobby zones | zoneTypes = {LOBBY} |
| Selected branches / zones | explicit locations / zones (multi-select) |

- **Every** top-level metric, the map, the location list, alerts, campaigns, announcement targeting and schedule
  targeting are computed over the filter's resolved **zone set** (zone = unit of audio truth). Location counters are
  derived ("location is playing if all its zones…" — exact rule per metric decided in Phase 3).
- The filter is **always intersected with the user's permission scope** server-side; the UI filter can only narrow.
- Saved filters ("My morning view") are a later convenience; the same expression is reused as a **target** for
  announcements / campaigns / schedules.

### 2c. CONTENT / POLICY INHERITANCE (D20 — designed for, NOT built)

```
Organization default → Brand default → Location override → Zone override      (most specific wins)
```

Applies later to: music / playlists, schedules, announcements, campaigns, opening hours, permissions/policies,
volume / duck levels, jingle pads.

Architecture rules so nothing blocks it:
- Every settings/policy row is keyed by **(scopeLevel ∈ ORG | BRAND | LOCATION | ZONE, scopeId)** — never by a bare
  `branchId` string. One generic resolver computes the effective value per zone.
- Content (playlists, announcements, assets) stays **organization-owned** and is *assigned* at a level — never copied
  per location.
- Schedules / campaigns store a **target expression** (§2b) plus the level they were authored at; they are expanded
  to zones at sync/send time (a new location in the brand/region is covered automatically).
- Overrides are explicit rows; "no row" = inherit. Locked items (e.g. a brand-mandated campaign a location may not
  override) are a policy flag, designed later.
- Timezone is **not** inheritable per zone — it is a property of the physical Location; zones always use it.

### 2d. PERMISSION SCOPES (D21) — COMPOSITE SCOPES LOCKED 2026-10-07 (not implemented)

A scope row is a **conjunction** of optional dimension filters (same expression as §2b); a member's effective
reach is the **union** of its scope rows, resolved at request time.

| Role | Scope row(s) |
|---|---|
| HQ Admin | ALL |
| Brand Manager | brands = {B1, B2} |
| Regional Manager | brands = {Golf & Co} ∧ regions = {Center} |
| Location Manager | locations = {L014} |
| Zone operator (later, if enabled) | zones = {Pool@Hotel TLV} |

- Capabilities (§3) are unchanged; only the scope representation generalizes. `authorize(user, capability,
  targets)` takes **targets = zones (or locations, expanded to their zones)**.
- WS tokens for broad scopes must carry the scope **expression or ALL**, not an ever-growing expanded id list
  (token size at 300 locations × N zones) — exact claim design decided in the permissions gate.

### 2e. DEPLOYMENT / ONBOARDING (D22)

**Bulk import (CSV / XLSX), idempotent by (organization, location code):**

| Column | Notes |
|---|---|
| Brand | created if new (admin confirms) |
| Location code | **unique per organization** — the import key |
| Location name | |
| Region | exactly one |
| Group(s) | `;`-separated, zero or more |
| Tags | `;`-separated, optional |
| Address / City / Country | |
| Timezone | default from organization if empty |
| Zones | `;`-separated, e.g. `Lobby:LOBBY;Pool:POOL;Spa:SPA` (name:type); empty = one default zone |
| Opening hours | optional; per location, zone override later |

**Activation:** import → for each Location/Zone the system issues a **station activation code** (printable sheet,
one line per zone) → technician installs VONO, enters the code → station binds to exactly that zone → OWNER/ADMIN
confirms designation (D1) → zone becomes PROVISIONED and shows 🟢. The technician never types brand / location / zone
names.

**Zones before hardware:** imported zones exist immediately as **UNPROVISIONED / ⚙ Setup required** (e.g. Hotel Tel
Aviv → Lobby · Pool · Spa, all created before any PC is installed). They can already be configured (playlists,
schedules, opening hours) but are never targeted for delivery until provisioned. **No fake StationDevice or fake
MASTER records** are created; a zone becomes provisioned only through real activation + explicit designation.

### 2f. TERMINOLOGY

Docs/UI say **Location** (generic) — the UI noun adapts per vertical (Store / Branch / Property / Club). Code keeps
the `Branch` table and `branchId` names (renaming would be a broad refactor with no product value — CLAUDE.md §3).

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
> **AMENDED 2026-10-07 (D21):** a scope row is a **conjunction** of optional dimensions (brands ∧ regions ∧ groups ∧
> tags ∧ locations ∧ zones) — single-dimension row types cannot express "Brand Manager" or "Golf & Co + Center".
> Adds **BRAND MANAGER** (brand scope) and a later **ZONE OPERATOR** (zone scope); REGIONAL MANAGER = brand ∧ region.
> See §2d.

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
> ⏸ **6** Not playing (during opening hours) · ⚙ **N** Setup required (unprovisioned zones — neutral)

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

- **Filters:** **Brand** · Region · Group · Tags · **Zone type** · Status (All · **Problems only** · Connection lost · Not playing · Closed) — one filter expression (§2b) driving every metric, the map, the list, alerts and campaigns (D19).
- **Multi-zone locations:** the card shows the location plus a compact zone strip (🎵 Lobby · 🎵 Pool · 🟠 Spa); single-zone locations look exactly as described here.
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
- **⚙ UNPROVISIONED / SETUP REQUIRED** (future operational state, per zone): the zone is configured but has no active
  designated playback Station yet (D18). Neutral (not red, not "connection lost", not counted as offline); shown in
  its own counter / filter so bulk onboarding can precede hardware installation. A location whose zones are all
  unprovisioned shows "Setup required". Status is per **zone**; location status aggregates its provisioned zones.

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
| Workspace (= Organization) | EXISTING | — (org defaults later via the inheritance layer, §2c) |
| **Brand** | NEW (D15) | `id, workspaceId, name, code?, logo?/color?`; one auto-created default brand per workspace |
| **Zone** | NEW (D16) | `id, branchId, workspaceId (denormalized), name, zoneType, isDefault, sortOrder`; exactly one `isDefault` per location (backfilled for every existing branch) |
| **Tag / BranchTag** | NEW (D17) | org-level label + N:M to locations (or `tags String[]` on Branch — decided at the gate) |
| **Policy / override rows** | NEW, later (D20) | generic `(scopeLevel ORG/BRAND/LOCATION/ZONE, scopeId, key, value)` — not built now |
| WorkspaceMember | EXTEND | role = preset; `capabilityGrants Json?` (explicit grants/revokes, e.g. `schedule.edit` for a Branch Manager) |
| UserBranchAssignment | EXTEND | ~~`scopeType` ALL / REGION / GROUP / BRANCH~~ → **scope row = conjunction** (`brandIds[]`, `regionIds[]`, `groupIds[]`, `tagIds[]`, `branchIds[]`, `zoneIds[]`; empty = any) — AMENDED 2026-10-07 (D21) |
| **Region** | NEW | `id, workspaceId, name, code?` |
| Branch (= Location) | EXTEND | **`brandId`** (required; default-brand backfill — D15); `regionId` (exactly one primary region — D3); `code` = location code, **unique per workspace** (import key — D22); address fields; `openingHours Json` (D8); `legacyKey` (done); `timezone` (EXISTING) |
| **BranchGroup** | NEW | `id, workspaceId, name` (additional groups only — regions are NOT groups) |
| **BranchGroupMember** | NEW | `branchId, groupId` (N:M) |
| StationDevice | EXTEND | station credential hash, `status` active / spare / revoked, `revokedAt`, activation metadata, **`zoneId`** (null ≡ the location's default zone) |
| **StationActivationCode** | NEW | `code (hashed), workspaceId, branchId, **zoneId**, expiresAt, usedAt, createdBy` |
| BranchMasterDesignation | EXISTING → EXTEND | `branchId` → canonical id (Gate 2 data migration); **`zoneId`**, uniqueness moves from (workspaceId, branchId) to (workspaceId, branchId, zone) — default zone ≡ today's row (D18) |
| Schedule (music) | EXISTING | executor moves to MAIN in a later phase |
| Announcement | EXISTING | the asset row; `branchId` → canonical or workspace-level |
| **AnnouncementSchedule** | NEW | `announcementId`, target = **filter expression** (§2b: brand / region / group / tag / location / zoneType / zone), `timeLocal`, `daysOfWeek`, `oneOffDate`, `startDate/endDate`, `lateGraceMin` (null = SKIP), `enabled`, `revision` |
| **AnnouncementSend** | NEW | one per HQ send: who, content, targets, `deliverOnReconnectMin` (null = NOW ONLY) |
| **AnnouncementDelivery** | NEW | `sendId` or schedule run, `branchId`, **`zoneId`**, `state`, timestamps, error (one row per target zone) |
| **BranchStatus** → **ZoneStatus** | NEW | one row **per zone** (= per playback unit): connection state + since, last-known audio state + time, safe title, app version, clock skew, lastSeenAt; location status = aggregate of its zones |
| AuditLog | EXISTING | more action types |
| JinglePadAssignment | EXISTING | `branchId` → canonical; later keyed by inheritance level (org / brand / location / zone) |
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

---

## 23. MULTI-BRAND + MULTI-ZONE — WHAT EXISTS, WHAT IS MISSING, WHAT WOULD BLOCK IT (2026-10-07)

Evidence: `prisma/schema.prisma`, `lib/authz.ts`, `lib/auth-ws-token.ts`, `server/branch-room.ts` (PROVEN BY CODE, read-only).

**Exists today:** Workspace (= Organization) · Branch (= Location: `code`, `timezone`, `city`, `country`,
`businessType`, `legacyKey`) · StationDevice (bound to workspace + branch) · BranchMasterDesignation (unique per
workspace + branch) · WorkspaceMember / UserBranchAssignment · authz engine in SHADOW (presets ADMIN / HQ_CONTROL /
REGIONAL_MANAGER — branch-scoped until a region model exists / BRANCH_MANAGER / VIEW_ONLY; scope = ALL or an explicit
branch set) · WorkspaceBusinessProfile (org-level business defaults) · Schedule (FK to Branch) · Announcement /
JinglePadAssignment (`branchId` plain string) · AnnouncementChannel (per workspace) · legacy `Device`.

**Missing today:** Brand · Zone (+ zone-type vocabulary) · Region · Group (+ membership) · Tags · conjunctive scope
rows / Brand-Manager and Zone-operator scopes · inheritance / override layer · location address fields · unique
location code · zone-level designation / station binding / status / activation code · filter-expression targets.

**Current choices that WOULD block Brand or Zone if left as-is — and the required adjustment:**

| # | Current choice | Why it blocks | Adjustment (at the relevant gate, not now) |
|---|---|---|---|
| B1 | **"Exactly one designated MASTER per branch"** — CLAUDE.md §11 + `BranchMasterDesignation @@unique([workspaceId, branchId])` + token claim `designatedMasterByBranch` | a hotel needs one MASTER per zone | **D18 FINAL 2026-10-07; CLAUDE.md §11 amended (applied)** + designation keyed by zone (max 1; 0 while unprovisioned); the default zone keeps today's row / claim so the accepted pilot is untouched |
| B2 | WS room = `ws:<workspace>:<branch>` (one playback room per branch) | commands to "the branch" become ambiguous with several MASTERs | the default zone keeps the existing key (LOCKED); additional-zone room format **DEFERRED** to the Zone Foundation Gate audit (§2a) |
| B3 | StationDevice / activation bound to (workspace, branch) only | a station cannot say which zone it plays | add `zoneId` (null ≡ default zone) |
| B4 | Planned scope types ALL / REGION / GROUP / BRANCH (single-dimension, union) | cannot express Brand Manager or "brand ∧ region" | conjunctive scope rows (§2d) — amend before the permissions gate is implemented |
| B5 | `authorize(user, capability, branchIds)` and token `authorizedBranches: string[]` | zone targets not representable; expanded id lists grow with locations × zones | targets = zones; broad scopes carry ALL / the scope expression in the token |
| B6 | Planned `BranchStatus` one row per branch | status truth is per playback unit | `ZoneStatus` per zone; location = aggregate |
| B7 | Planned announcement / schedule targets "branch / region / group" | no brand / zone-type / zone targeting | targets = filter expression (§2b); deliveries per zone |
| B8 | Settings keyed by bare `branchId` strings (Announcement `branchId` default "default", JinglePadAssignment; Schedule.branchId FK) | no org / brand / zone levels for inheritance | new settings use (scopeLevel, scopeId); existing rows = LOCATION level (default zone) — migrate only when each feature is touched |
| B9 | `Branch.code` default "" and **not unique** | bulk import cannot be idempotent | unique (workspaceId, code) once codes are backfilled |
| B10 | Region / Group not built yet; the D3 example put "24/7" in Groups | risk of re-using Groups as Zones or Tags | D17: Region / Group / Tags are classification only; Zone is a separate table |

**Not blocking (verified):** Workspace = Organization fits — brands are a level *inside* it (modelling brands as
separate workspaces would break cross-brand HQ, shared users and shared content, so it is rejected). Canonical
Branch ids (Gate 2) are the right anchor for Location. Timezone on Branch is correct (zones inherit it). The capability
set (§3) needs no change. The playback plane (MAIN / MPV / orchestrator) is per station and needs no change for
zones — a zone station is just another designated station.

**Sequencing:** none of this changes the current P0 playback work or the accepted pilot. Brand + Zone tables (with
default-brand / default-zone backfill) should land **before or together with** the Region / Group permissions gate, so
scopes, status and targets are built on zones from the start instead of being retrofitted.

---

## 24. CLAUDE.md CONSTITUTIONAL AMENDMENT (D18) — APPLIED 2026-10-07

Approved by Dotan 2026-10-07 and applied to `CLAUDE.md` in the same docs-only commit as this blueprint lock:
- **§11 "Permanent MASTER architecture — HARD INVARIANT"** rewritten around the Zone as the playback-authority unit,
  with the final D18 lifecycle rule (*At most one designated MASTER per Zone at all times. Every active / provisioned playback Zone must have exactly one designated MASTER. An unprovisioned Zone may temporarily have zero designated MASTERs.*), provisioned / unprovisioned definitions, multi-station zones,
  no-steal / no-failover / audited standby promotion, default-zone backward compatibility, zones as the final
  playback destination, and the additional-zone WS room format DEFERRED.
- **§2 pilot priority 3:** "permanent branch / zone MASTER identity".
- **Architecture → WebSocket Device Registry:** designated zones (today every designated branch = its single default
  zone), at most one designated MASTER per zone, no automatic failover.

`CLAUDE.md` is the authoritative text; this section only records the change.
