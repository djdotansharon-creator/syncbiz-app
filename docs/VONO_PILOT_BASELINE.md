# VONO PILOT KNOWN-GOOD BASELINE

> Operational, changeable state. Update after EVERY runtime-accepted blocker (CLAUDE.md §8).
> Permanent rules live in `CLAUDE.md`. No secrets in this file — ever.
> Evidence labels: `ACCEPTED — owner-attested <date>` (Dotan on the Lenovo; not independently
> inspected by Claude) vs `ACCEPTED — server-log corroborated` (TEST WS/server logs).
> Earlier baselines are kept verbatim-in-substance in §13 HISTORY — never delete history.

## 1. STATUS

- **🟡 PRESENTATION LOCK (owner 2026-10-09).** 4 tracks: (1) PLAYER / STATION — FROZEN (owner-approved critical fixes
  only); (2) CONTROL ROOM; (3) DESIGN / UX; (4) AFTER PRESENTATION (synced video always-on without the SYNC button, URL
  load latency, Play Now, equal-power mix, station speed, now-playing frame, external screen). TEST only, PROD untouched.
  beta.21 restart: owner-attested PARTIAL 2026-10-09 (resumes the last song after a Windows restart); offline boot /
  LOCAL→URL on network return / video not yet tested → not a full PASS.
- **🔴→🟡 P0 JINGLE CHANNEL RECOVERY (STEP 0 before Scheduling) — beta.23 TEST candidate (2026-10-13), NOT installed / NOT accepted. DESKTOP MAIN.** Source `8f3258b` (local, NOT pushed).
  - Root cause: (a) PROVEN BY CODE — Channel B cleared `interruptBusy` only after a clip reached "playing"; a load while the interrupt MPV was down / restarting (play() pushes idle+error, no start-file) or an MPV death between load and start-file → busy forever: music DUCKED forever + jingle queue stuck (only a global STOP freed it). (b) PROVEN BY TEST (standalone mpv, VONO options, Dev-PC) — start-file fires at once even for failing loads; end-file(error) only after refused 37 s / blackhole 55 s / stall 33 s → music ducked that long.
  - Fix (owner rules): new pure `desktop/src/main/interrupt-channel.ts` = ONE idempotent cleanup path (completed / load_error / playback_error / engine_down / no_start_timeout / stall_timeout / stopped): volume restored, clip cleared, queue unlocked, next clip continues, timers cleared. Explicit failure → immediate; 10 s no-progress failsafe only; attempt-bound events (late events of a previous load ignored). Orchestrator wiring only (Channel B ports: interruptMpv.play/stop + duck/unduck); playInterrupt / stopInterrupt signatures unchanged; no music / global STOP change. Logs INTERRUPT_END / INTERRUPT_ABORT {reason, attemptId, ms} — never the URL.
  - Tests: verify-interrupt-channel 24/24 (behavioural, fake deck + clock: normal, immediate failure, no-start timeout, unreachable URL, stall, MPV death before/after start, no process, double failure = one cleanup, next queued continues, stale events, stop, dedupe + wiring guards). REAL-MPV integration `scripts/itest-interrupt-real-mpv.ts` (Electron + mpv.exe, 127.0.0.1 only) 9/9: normal 2.9 s, corrupt 0.3 s, refused URL 10.0 s, stalled download 10.0 s, mpv killed mid-jingle 0.06 s, watchdog restart + failed then good clip continues, end state not ducked / volume 80. All 32 desktop suites green; build tsc clean (typecheck's 3 errors pre-existing).
  - **Installer `2.2.8-beta.23`** SHA256 `559a15b65dc644ca613003910e90737c18242985e729777f449a5d4da84b628d`, 140,789,567 bytes, unsigned, NOT published, TEST-pinned (transient: hosted-url.ts → TEST app + WS; normalizeEndpointsForPackaged → force TEST; version → beta.23; all reverted, tree clean). asar verified (beta.23, TEST hosts only — PROD host only in a comment, interrupt-channel present). Copy: `D:\SyncBiz_Backups\pilot\2026-10-13-beta23-jingle-channel-recovery-8f3258b\`. Rollback = preserved beta.22. NOTE: the beta.23 number previously planned for AUTOMIX / Shuffle on MAIN → that work moves to a later beta.
  - ⚠️ TEST INCIDENT (2026-10-13, Dev-PC): the real-MPV integration test ran while the Dev-PC's own VONO (beta.22, TEST Pilot Branch station) was running; MPV pipe names are fixed → the test's IPC client attached to the LIVE interrupt MPV: the Dev-PC main.log shows the test clips 13:46:39–13:47:07Z (silent wav + failing URLs, Channel B only). Read-only check afterwards: music deck A idle (nothing playing), deck B prepared/paused, interrupt idle; volumes 38 / 80 do not match the test's values (32 / 80) → no evidence of a music change. Fix `98f2c70`: the itest refuses to run while mpv.exe / SyncBiz Player.exe runs. The itest results are real-MPV behaviour but were measured on that shared pipe → re-run with VONO closed when the owner allows; the Lenovo regression is the acceptance gate anyway.
  - ✅ CLEAN RE-RUN (owner-approved 2026-10-13): Dev-PC VONO closed normally (window close → before-quit; Protection OFF there), 0 mpv / VONO processes before; itest extended (test-only) to read back the music-deck volume per case + count cleanups. **13/13 PASS — PROVEN BY TEST (real mpv, isolated):** normal 2843 ms completed · broken file 29 ms load_error · unavailable URL 10008 ms no_start_timeout · network drop 10008 ms no_start_timeout · MPV killed 30 ms engine_down (+ own watchdog restart) · failed → queued good clip: load_error → completed · double failure (broken clip + MPV kill together) = exactly ONE cleanup (engine_down) and the next jingle completes. Volume after EVERY case = 80 (duck low 32), never two end events for one clip across the run, end state not ducked / queue empty. 0 mpv / electron / VONO processes afterwards; temp dirs removed.
  - Installer = tested code: no desktop/src change since `8f3258b` (only test + docs commits after it); fresh tsc of HEAD vs the beta.23 app.asar → interrupt-channel.js, playback-orchestrator.js, mpv-manager.js, device-ws-manager.js IDENTICAL. Installer SHA256 unchanged `559a15b6…4b628d` (dist-installer + backup copy, 140,789,567 bytes). No rebuild needed.
  - Lenovo regression REQUIRED (owner list): normal jingle · URL unavailable · internet drops · corrupted file · MPV restart · queued jingle after failure · jingle during AUTOMIX transition — each: music back to normal volume + queue keeps working.
- **🟡 JINGLES STEP 1 (VxSelect) — 2026-10-13. RENDERER ONLY, TEST. AWAITING OWNER CHECK.** Commit `2ddd83e`, Railway deploy `79243ebb-aa9e-49c2-93f6-ca51fc392dba` (SUCCESS; 5 changed files hash MATCH).
  - New `components/management/vx-select.tsx` (+ `.vx-select*` in globals.css): dark frameless select-only combobox (ARIA combobox/listbox/option; ↓↑ Home End PgUp/PgDn Enter Space Esc Tab + type-ahead; portalled fixed list, RTL-aware). No native white popup, no shadow/glow/gradient.
  - Used ONLY in Jingles: Studio Type / Language / Voice / Speed / Bell + audience editor Brand / Region / Branch (Create target, Assign, Change target). Same values + same logic (verify-jingles-ui U14–U16, 16/16). Studio settings row may wrap in the narrow Control Room column. Other screens untouched.
  - Local runtime (mocked APIs): keyboard + mouse choose, Esc keeps value, Language→voice reset + Speed hidden, Assign PATCH body = BRAND_REGION yh/south on the same row.
- **🟡 JINGLES STEP 0 (Control Room Create / Save / Preview audit) — 2026-10-13. RENDERER ONLY, TEST.** Commit `23c249e`, Railway deploy `3760939b-1e50-4d91-9a45-5bfa2c4b58e2` (SUCCESS; JinglesShell.tsx / jingles-panels.tsx / management.ts hash MATCH).
  - Generate: PROVEN BY RUNTIME (TEST logs `[jingles/generate] saved …mp3`). Save: PROVEN BY RUNTIME (TEST DB rows with BRAND_REGION / NETWORK / BRAND audiences; one legacy row still UNASSIGNED). Audio served 200 audio/mpeg.
  - Fixed: no confirmation after Save → back to the list, 'Saved: <name>' banner, new row first + highlighted.
  - Desktop 'can't hear Preview': PROVEN BY CODE — `desktop/src/main/index.ts` `win.webContents.setAudioMuted(true)` (all audio via MPV by design). Preview works in a browser. Changing it = DESKTOP MAIN + installer → OWNER DECISION (PARKED).
- **🟡 JINGLES STAGE 1 UI — TEST candidate (2026-10-13), NOT accepted.** RENDERER ONLY (no Pads logic / PLAYER / MAIN / WS / DB / PROD). Commit `59c0771`, deploy `f79903a4-a407-4e49-9c8f-89f85d11d910` (6 files hash-identical). Broadcast safety (only playable + every recipient eligible; re-check at send, ineligible → no command); branch panel two groups (Branch jingles / Available to this branch) with badge · duration · Preview (local) · Play now (confirmed, this branch) · HQ Share; Control Room → Jingles (HQ): Pending assignment + library + change audience; Create = SAME JinglesWorkspacePanel (controlRoom surface: no tabs / Pads / local On-Air / Add to Pad / Schedule; audience card; save blocked without audience). Local runtime with mocked APIs: panel + badges, Create preset BE · SOUTH reaches 1 (other brand excluded), context kept after closing, two groups, Share → PATCH same id, Preview → 0 server calls. verify-jingles-ui 13/13, jingles-audience 13 (+11 DB earlier), suites green. Owner runtime check pending (TEST login: Play now / Broadcast to a live station, Lenovo regression).
- **🟡 JINGLES STAGE 1 SERVER — TEST candidate (2026-10-12), UI NOT built.** **SERVER** (no UI / BranchPanel / Studio / Pads / Player / MAIN / WS / PROD; no new migration — columns from c45348d). Commit `ff5bb36`, deploy `dbafd1ae-0627-4a42-8a08-14e6899db9b3` (5 files hash-identical). One rule set lib/jingles/audience.ts (UNASSIGNED HQ-only + never playable; LOCAL; BRAND; REGION HQ-only create; BRAND_REGION; NETWORK; region = map lat/lng resolver; unbranded = default brand; legacy rows = UNASSIGNED; legacy branchId unused) + lib/jingles/library-service.ts. Permissions = existing mechanism (access type OWNER = HQ; BRANCH_USER + assigned branches). API: GET ?branchId=, POST audience / originBranchId (HQ default UNASSIGNED; branch user LOCAL own branch only), PATCH /api/jingles/library/<id> (HQ only, same row, audited `jingle.audience_change`). Tests: verify-jingles-audience 24/24 (13 rules + 11 real routes on a throwaway DB, dropped) + gate2a 25, gate3a 36, gate2b1 36, gate3b4a 14, announcements 4, control-room suites green. TEST: GET / PATCH 401 unauthenticated; the 3 existing jingles still UNASSIGNED, origin NULL. Known (UI phase): HQ GET without branchId still returns UNASSIGNED items (flag playable:false) → the current Broadcast list still shows them until the UI filters on `playable`; WS does not enforce audience (WS-lock stage).
- **🟡 PLAYER AREA LANGUAGE (Queue / tiles / selects / result) — TEST candidate (2026-10-12).** RENDERER ONLY, display only (class names + CSS; live-queue-panel.tsx + sources-manager.tsx touched ONLY for hook class names). Commit `d690ea3`, deploy `33d6de6b-56a4-4ca8-9c4a-8d2337e609fe`. Queue rows hairline (now playing = fill + underline; amber bar hidden), playlist tiles = rows, Jingles selects dark + chevron, result column. Measured locally (tiles 0 radius / 1px bottom; queue rule checked on a temporary probe row). NOT done this round: the deck boxes (Queue / player / Pads frames) and Scheduled Playlists cards — a wider player-shell change, owner decision.
- **🟡 JINGLES STUDIO FRAMELESS — TEST candidate (2026-10-12).** RENDERER ONLY, display only. Commit `d6cb0f2`, deploy `af36343d-d606-4421-934d-2dead852f51a`: owner — no boxes / frames; flat surfaces lighter on hover, focus underline; panel ✕ hidden (launcher toggles; verified setActiveCenterModule toggle in app-shell); result microphone removed; selects keep full text (measured). Rule for the whole language: frameless controls, hover tone, underline = active.
- **🟡 DESIGN LANGUAGE STEP 2 (Jingles Studio) — TEST candidate (2026-10-12).** RENDERER ONLY, display only (no jingle / playback / pads / save / schedule logic). Commit `60ff949`, deploy `43abba9d-e03e-4993-bbae-f1c4eeb75851`: tabs underline (16 px, 3 px accent), flat 2 px fields 16 px, one filled primary, outlined secondary, Library / Schedule hairline rows (16 / 14 px, no card), flat modals; measured locally (rows 74 / 64 px, no overlap; settings row one line). Quick Pads untouched. Not screenshot-verified (desktop window minimized during the check) → owner visual check.
- **🟡 DESIGN LANGUAGE STEP 1 — TEST candidate (2026-10-12).** RENDERER ONLY. Commit `48abfda`, deploy `2ae38309-a25c-4958-ba32-1391e05ffd6c`. Owner: "Flat Swiss-style Management UI — hairline dividers, zero / minimal radius, strong typography, active-state underline indicator". Shared tokens `--vx-*` + opt-in `.vx-*` classes in app/globals.css; Control Room Stat / FilterTab / RegionChip moved unchanged to components/management/primitives.tsx. No visual change: Control Room computed-style fingerprint identical before / after (289 elements, 8e66bbd46cb3497c). Next: step 2 Jingles, then Access Control, then Dashboard.
- **🟡 JINGLES QUICK PADS ROUND 3 — TEST candidate (2026-10-12).** RENDERER ONLY, display only. Commit `bb45313`, deploy `d8ed6651-d504-49fa-82f7-04ecdd6a1880`: bar only on selected / on-air; lines only between cells (no outer frame).
- **🟡 JINGLES QUICK PADS ROUND 2 — TEST candidate (2026-10-12).** RENDERER ONLY, display only. Commit `ea830e5`, deploy `0f0d8b9d-b3e3-466e-8485-e002a74fb2e5`: owner — Control Room look: square cells + thin lines (no rounded cards / glow), round color LED next to the name (measured: no overlap), full-width bottom bar.
- **🟡 JINGLES QUICK PADS LOOK — TEST candidate (2026-10-12).** RENDERER ONLY, display only (same pads / clicks / drops / edit; no DB / PLAYER / MAIN / WS). Commit `c831cdf`, deploy `d8e3196e-b793-4d29-84cb-eb7ac4a93eaf` (= deploy B: also carries the Stage-1 schema, matching the migration already applied). Pads 4×2 cards, softened per-pad color identity, swatch + state line + bottom LED bar; states rest / hover / selected (focus, drop) / on-air (gentle pulse). Found + fixed in the same change: taller pads squeezed the Create form (Generate button over the text box) → the form keeps its natural height.
- **🟡 JINGLES STAGE 1 — DATABASE migrated on TEST (2026-10-12), UI NOT built yet (owner: stop and verify data first).** **DATABASE** (TEST only; no PROD). Migration `20261012140000_jingle_audience` (commit `c45348d`): `Announcement` + nullable `originBranchId` (real origin; NULL = HQ), `audience` (UNASSIGNED | LOCAL | BRAND | REGION | BRAND_REGION | NETWORK), `audienceBranchId` (LOCAL target), `audienceBrandId`, `audienceRegion` (stable key) + index (workspaceId, audience). Legacy `branchId` untouched (owner). `migrate diff` vs schema = no difference (throwaway local DB, dropped). Two-phase: deploy A `e502e1ce-06a0-4fc3-a291-d3f98fcd7f2b` (old code + migration folder) → `prisma migrate deploy` → data: the 3 existing jingles `audience=UNASSIGNED`, `originBranchId=NULL`, legacy branchId hash unchanged. Backup + rollback: `D:SyncBiz_Backups	est-env61012T140347Z-jingle-audience` (Announcement.json + ROLLBACK.md). TEST app currently runs deploy A (= 3f239be UI + the migration); /login 200, jingle APIs 401 unauthenticated. Decisions: B (Control Room → existing Jingles Studio with audience preset), region from lat/lng with the map code, pads per branch = Stage 1b.
- **🟡 CONTROL ROOM EMPTY-REGION MESSAGE — TEST candidate (2026-10-12).** RENDERER ONLY. Commit `3f239be`, deploy `e0ad7fd6-a1c0-473f-ae85-677b0c71b4d3`: owner agreed filters never reset the region; a region with 0 matches shows a message + "Show in All Israel".
- **🟡 CONTROL ROOM UX ROUND 6 — TEST candidate (2026-10-12).** RENDERER ONLY. Commit `ded9674`, deploy `45ac3116-0346-48da-8612-947708c61ba3`: region row never scrolls (overflow hidden, 12 px); Compact 40%; map column min 680 px so the row always fits (measured 1280 + 1440).
- **🟡 CONTROL ROOM UX ROUND 5 — TEST candidate (2026-10-12).** RENDERER ONLY. Commit `153d9d2`, deploy `cb65e898-0140-4e10-8598-3205ad571e68`: regions = one compact row (13 px, no counts, fits Compact at 1440); big branch count on the right of the map (follows the chosen region).
- **🟡 CONTROL ROOM UX ROUND 4 — TEST candidate (2026-10-12).** RENDERER ONLY. Commit `62dac32`, deploy `936687a1-ad95-4fb7-ab5d-659c64ae9339`: map header = place + one frameless toolbar (sizes with LED, + / − / Fit via a portal from BranchMap); regions strip under it inside the map area; no separate "All Israel" back button.
- **🟡 CONTROL ROOM UX ROUND 3 — TEST candidate (2026-10-12).** RENDERER ONLY. Commit `30c1d35`, deploy `23b6263b-9339-432c-ba7c-583cd9ccb0b6`: legend stacked on the left side of the map; order statuses → brands → regions → search.
- **🟡 CONTROL ROOM UX ROUND 2 — TEST candidate (2026-10-12), NOT yet accepted.** **RENDERER ONLY**. Commit `90d8abb`, deploy `0166a6d0-01d1-4f20-8208-700b86242b17`. Owner: order Brands (big tabs, brand-color LED) → status KPIs → regions → search; ONLY the right-hand table / panel scrolls (screen fills the page, map column fixed, map fills the height — supersedes round 1 sticky page scroll); entering a region keeps the map size (reverses "Compact → Balanced"); zoom + / − / Fit at the top of the map; Back to Player = a tab with an LED bar (no frame, note icon). Map ~330 px tall at 1440×900 (more on 1080p). Tests map-ux 16/16, regions 21/21, brands 6/6, management-mode 8/8.
- **🟡 CONTROL ROOM UX ROUND — TEST candidate (2026-10-12), NOT yet accepted.** **RENDERER ONLY**. Commit `609edee`, deploy `8f3e9cf4-55f9-4c3e-b2d6-18396b538afc` (hash-identical). Scroll audit (measured locally on the real route, mocked APIs): before = page + the 640 px branch-list window + a 1 px vertical scroller on the brand row (overflow-x side effect); after = ONE scroll (the page), map column sticky, no nested lists in Broadcast. Region bar in the KPI language (All Israel + 7 regions, LED bar, click again → All Israel; big "All Israel" button inside a region). Bigger brands (16 px, 52 px rows, 3 px brand bar, count chips), KPI labels 16 px, branch names 18 px, statuses 16 px, search 16 px. Markers r 6 → 5, breathing scale 1.55 / 2.4 s. "Back to Player" = exit button at the start of the management bar (arrow + note icon), tabs 15 px. Tests map-ux 16/16 (U1–U2), regions 21/21, brands 6/6, management-mode 8/8.
- **🟡 MANAGEMENT EN / HE + RTL + SINGLE-CIRCLE MARKER — TEST candidate (2026-10-12), NOT yet accepted.** **RENDERER ONLY** (no PLAYER / MAIN / STATION / WS / DB / PROD change; app-shell = management nav labels only). Stage 1 `a5c8628` → deploy `2df336a9-df1d-43d6-9e72-ca7307b99bc4`; Stage 2 `96be548` → deploy `01f63c1e-c32c-467e-87c4-481878eaf396` (changed files hash-identical). Owner decisions: marker = ONE circle (brand color; Offline muted; Playing slow breathing, off for reduced motion; Needs installation amber; no rings / badges); legend at the TOP of the map; nav "הרשאות", screen "ניהול הרשאות". One typed dictionary `lib/i18n/management.ts` (MGMT_HE: Record<MgmtKey,string> → a missing Hebrew string fails the build) driven by the existing locale switch; RTL only inside Dashboard / Control Room / Broadcast / Access Control (the global LTR rule stays for the player); map, + / −, codes, times, numbers, emails never flip. Tests: map-ux 14/14 (A4 / L1–L3), regions 21/21, management-mode 8/8 (M4 wording adjusted, same invariant), brands 6/6. Visual: Control Room EN + HE locally (mocked APIs); Access Control HE checked in its owner-required state only (needs an owner session) → owner check on TEST.
- **🟡 CONTROL ROOM STATUS FILTER — TEST candidate (2026-10-12), NOT yet accepted.** **RENDERER ONLY**. Commit `aa82032`, deploy `f2504ea7-859d-4e65-9c20-f98f9d825970` (changed files hash-identical). The KPI counters are the status filter: All branches / Playing / Online (= playing or idle) / Offline (station exists, not connected) / Needs installation (no station yet); click → map + list; click again or All branches → clear; combined with Brand + Region + Search (e.g. BE + South + Offline); KPI numbers follow Brand + Region + Search but not the chosen status; live statuses disabled while live status is unavailable. One derived `BranchStatus` in lib/control-room-filters.ts (ready for a future Dashboard Needs-attention evaluator — NOT built). Tests regions 21/21 (S1–S5), brands 6/6 (P6 wording adjusted, same invariant), map-ux 11/11. Pending owner decisions: marker variant (A/B/C), RTL in Management only, Access Control Hebrew name.
- **🟡 CONTROL ROOM REFINEMENT — TEST candidate (2026-10-12), NOT yet accepted.** **RENDERER ONLY** (no PLAYER / MAIN / STATION / WS / DB / PROD change). Commits `5200092` (operational regions) → `00017a8` (map size + zoom) → `3acabc6` (readability); deploy `52bc1e4a-78f6-4033-8879-198fbea66bfb` — 9 changed files hash-identical to `3acabc6` (CRLF checkout). **1. VONO Operational Regions** (owner decisions; NOT an official division): North, Haifa & Krayot, Sharon & Shomron, Gush Dan, Shfela, Jerusalem & Modi'in, South = unions of the 15 official sub-districts (geoBoundaries ADM2, CC0) + real municipal exceptions from OpenStreetMap (ODbL, attribution shown): Rishon → Gush Dan; Kfar Saba / Ra'anana / Hod HaSharon → Sharon & Shomron; Modi'in-Maccabim-Re'ut → Jerusalem & Modi'in. Judea & Samaria by rule (lat ≥ 31.98 → Sharon & Shomron, else nearer of Jerusalem & Modi'in / South). Region by lat/lng only; a branch in Israel always gets a region; "Outside" = Outside Israel only. TEST branches 9/9 assigned (Rishon via exception). **2. Map size** Compact 35% / Balanced 50% (default) / Map focus 68%, remembered per viewer (localStorage, try/catch); entering a region from Compact → Balanced; zoom + / − / Fit, Ctrl/Cmd + scroll around the cursor, drag to pan while zoomed (Add / Edit preview map unchanged). **3. Readability** (Dashboard / Control Room / Access Control only, `.mgmt-type` on the page roots): secondary text 14 px, stronger secondary / tertiary contrast, invisible 44 px hit areas on buttons (no layout change) + 44 px fields, branch name 16 px, titles 18–22 px, status legend, status by shape (dashed = offline, dotted = needs installation) not color only. Tests: verify-control-room-regions 16/16, verify-control-room-map-ux 11/11, management-mode 8/8, brands 6/6, announcements-security 4/4 (DB part skipped). Visual check locally with mocked APIs (Control Room); Access Control / Dashboard not visually checked (need an owner session) → owner check on TEST.
- **🟡 MANAGEMENT MODE + CONTROL ROOM REGIONAL MAP — TEST candidates (night of 2026-10-11/12, owner-delegated), NOT yet accepted.** Both **RENDERER ONLY** (no PLAYER / provider / MAIN / STATION / WS / DB / PROD change). **Step 1 Management Mode `69f191d`, deploy `6dbfb4db-0776-445a-9e2a-946024282e87`:** Dashboard / Control Room / Access Control full screen with nav Dashboard | Control Room | Access Control + Back to Player; the player row is the SAME element (class `mgmt-deck-hidden` + inert + aria-hidden only) — browser: 320x180 transparent fixed box (YouTube keeps playing), desktop app: display:none (MPV slot rect 0 → no stray native window); Dashboard + Access Control moved out of (workspace) (URLs unchanged; device-socket route rules unchanged). Runtime (local dev): Player → Dashboard → Control Room → Access Control → Player = AppShell diag remount=false every step + the same player DOM node / media elements connected throughout (`PROVEN BY RUNTIME`, local, no audible playback — local add-URL failed); desktop rule verified by attribute simulation. Tests verify-management-mode 8/8. **`ACCEPTED — owner-attested 2026-10-12`:** on the Lenovo while playing, Player → Dashboard → Control Room → Access Control → Player — playback continued with no interruption. MANAGEMENT MODE = PASS. **Step 2 Regional map `d77b3f6`, deploy `1b754ac6-0117-419a-bd22-7d3399015377` (hashes identical incl. app-shell / audio-player / providers):** regions = Israel's 6 administrative districts (Natural Earth 10m admin-1, public domain; ISO IL-Z / IL-HA / IL-TA / IL-M / IL-JM / IL-D) as VONO operational regions (North, Haifa & Krayot, Tel Aviv – Gush Dan, Center & Sharon, Jerusalem Area, South) — no invented boundaries (Shfela / Krayot are not administrative units). Automatic region from stored lat/lng (point-in-polygon; coastal snap ≤5 km off-land; on-land border slivers ≤0.4 km; Judea & Samaria / abroad = Outside regions; no coordinates = no_location, shown + explained). Hover = gentle lift + name + count; click = animated focus ("← All Israel", region name, count); search (name / number / city / address); Brand + Search + Region combined (lib/control-room-filters.ts); Broadcast keeps the brand scope only. Tests verify-control-room-regions 14/14 (44 places, 650 border points, filters) + brands 6/6 (P6 wording) + suites green; real AllBranchesView exercised locally with mocked APIs. TEST branches: 9/9 in the expected region. Open: local dev DB (syncbiz_dev) is behind the schema (Control Room APIs 500 locally — not changed, no DB action).
- **🔒 SECURITY HOTFIX — /api/announcements + /api/logs — TEST (2026-10-11), owner priority #1.** Head `9e6627c` (local, NOT pushed). **SERVER only** (no DB / PLAYER / MAIN / WS). Was (PROVEN BY CODE + TEST runtime 200): GET /api/announcements with no auth and no workspace filter (cross-tenant read of non-jingle announcements), POST unauthenticated (fake "system" workspace; no caller in the app), GET /api/logs unauthenticated. Fix: GET announcements signed-in + caller workspace only; `lib/store.ts getAnnouncements(accountId)` workspace REQUIRED (missing / unknown → []); POST → 405; GET logs signed-in; announcements / logs / dashboard pages forward the session cookie to these two APIs only. Tests `scripts/verify-announcements-security.ts` 9/9 (throwaway DB: 401 / 401 / 405, store w/o workspace → [], A never sees B, signed-in user gets own rows); regression suites green. Deploy `8bc46a4e-d3da-4361-8a41-683005df159f` (= 9e6627c, hashes identical incl. audio-player); runtime: GET announcements 401, GET logs 401, POST 405, health 200. Signed-in page view = owner check. **✅ PROMOTED TO PROD 2026-10-11 (explicit owner approval; owner chose merge to main):** branch `hotfix/announcements-logs-auth` = cherry-pick `0307819` of 9e6627c on main 951a44c (typecheck + verify-announcements-security 9/9 on main schema; Vercel preview PASS) → PR #53 merged → main `7543abf`. Auto-deploys (GitHub deployments, all SUCCESS): Vercel Production `7001031881`, Railway focused-exploration `7001018350` (app + ws services — the PROD WS service most likely redeployed with UNCHANGED code), lucid-healing `7001018429`, balanced-abundance `7001018427`. PROD runtime: https://syncbiz-app-production.up.railway.app and https://syncbiz-app.vercel.app → GET announcements 401, GET logs 401, POST 405 (Railway health 200; Vercel /api/health 503 — not investigated, NOT caused by this change to our knowledge). lucid-healing / balanced-abundance public domains not known here → not runtime-checked (same commit deployed SUCCESS). PR #52 untouched. Supersedes PARKED item 10 (generic /api/announcements POST). Also found: `verify-control-room-f1.ts` A16 static guard ("only lib/store.ts imports control-room-foundation") fails since Step A branch management (10-10) + brands — stale guard, not this fix; adjust separately.
- **🟡 CONTROL ROOM BRANDS — TEST candidate (2026-10-11), NOT yet accepted.** Head `91eded0` (local, NOT pushed). **RENDERER + API only** (existing `Brand` table — no DB migration; no PLAYER / STATION / WS / PROD change). Organization → Brand → Branch: Brands panel (add / edit name, code, color; owner only via requireBranchManager; code unique per organization; color strictly #RRGGBB); Brand select in Add / Edit branch (server: brand must be a non-archived brand of the SAME organization, else 404); brand badge in the list; Brand filter chips (map + list + counters); map marker CENTER = brand color, RING = status; Broadcast All / Brand / Selected — All and Brand include every branch of the scope (offline → Not delivered, no command), same per-branch PLAY_INTERRUPT + COMMAND_DELIVERY. Default Brand = fallback for NULL / archived brand ids (no branch disappears). No delete / archive, no permission change. Deploy `8b1267bf-bb90-40cc-b9f9-ee73d708d33e` (= 91eded0; brand + player files hash-identical; brands API without session → 401). Tests: verify-control-room-brands 21/21 (throwaway DB), branch-mgmt 47/47, station-activation 25/25. Owner creates the brands + assignments himself (no demo data).
- **🟡 BETA.22 — STATION MEDIA TOKEN — candidate (2026-10-11), NOT installed yet / NOT accepted.** Root cause (PROVEN BY CODE + server probe + Dev-PC main.log 16:09:36Z standby_decode_failed): Music Bank stream URLs reach MAIN token-free (the `mt=` token is appended only on the renderer path; MAIN owns URL sessions since 2026-10-08) → /api/media 401. Fix `79087d3` (owner option A): **SERVER** /api/music-bank/authorize accepts `Bearer desktop_access` bound to a station (verifyDesktopStationToken; StationDevice must exist in the signed workspace; token scoped to that station; cookie path unchanged) — TEST app deploy `c0eb6d13-3967-48b2-9cde-dda17332cf75` (hashes identical; bad/none bearer → 401). **DESKTOP MAIN** `media-token-provider.ts` (station fetches + refreshes its own token; never over WS, never logged) + ONE hook in MpvManager.play (`withStationMediaToken`, identity for every non-/api/media URL). Tests: verify-media-token-provider 19/19, verify-station-media-authorize 11/11, all 31 desktop suites green, auth/station suites green. **Installer `2.2.8-beta.22`** SHA256 `016eeccc2b2b9d090d812b6bc3420ce33ddf2975dd7ed493c22d4ded8fb9a018`, 140,783,839 bytes, unsigned, NOT published, TEST-pinned (transient: hosted-url.ts → TEST app + WS; normalizeEndpointsForPackaged → force TEST; version → beta.22; all reverted, tree clean). asar verified (beta.22, TEST hosts only, module + hook present, no mpv-diag). Copy: `D:\SyncBiz_Backups\pilot\2026-10-11-beta22-station-media-token-79087d3\`. **Install ONLY on the second computer (dsk-644a7271, UNV-094); the Lenovo stays on beta.21 until owner approval.** **Owner 2026-10-11: beta.22 also INSTALLED ON THE LENOVO (owner decision) — works (`owner-attested 2026-10-11`). Rollback for the Lenovo = the preserved beta.21 binary.** **Runtime 2026-10-11: beta.22 installed on the second computer — Royalty-Free stream PLAYS there (`owner-attested 2026-10-11`; main.log not yet inspected). Jingles during RF + 3 genres: owner-attested OK. Remaining (sequence, YouTube, Control Room commands, branch isolation) pending.** **PARKED (pre-existing since the 2026-10-08 MAIN URL-session ownership, NOT a beta.22 regression; PROVEN BY CODE):** on a designated station the AUTOMIX / Shuffle buttons send COMMAND SET_AUTOMIX / SET_SHUFFLE to MAIN, which has NO handler → no effect for URL / YouTube / stream sessions (LOCAL works via the renderer). Owner chose: plan the fix for beta.23 (audit first, no build yet). Known limit: a stream source restored in the first ~1 s after boot may start before the first token arrives (Gate 2d fallback applies).
- **ROYALTY-FREE DEMO BANK — TEST DATABASE rows written 2026-10-11 (owner-approved), catalog NOT enabled yet.** R2 bucket `syncbiz-media-prod` already held all 176 catalog samples at the content-addressed keys (read-only list, 623.5 MB, 177 objects; 1 unrelated root object kept). TEST app has a NEW **Object-Read-only** R2 token scoped to that bucket (R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_S3_ENDPOINT) + SYNCBIZ_MEDIA_SECRET (owner-set; the write key stays only in the Dev-PC `.env.r2.local`); Railway redeployed the app on the variable change (`eaeeaae7`, same source). Driver `scripts/music-bank/ingest-catalog.mjs` (`e377772` + export option) ran the EXISTING ingestFile in dry-run over an in-memory DB seeded from a read-only TEST snapshot (uploads blocked; R2 HEAD only): 176/176, 7/7, 352 rows, 176 already in R2, 0 uploads, 0 conflicts. TEST Postgres has no public endpoint → the exact exported rows were replayed INSIDE the TEST app container in ONE insert-only transaction (pre-check: 0 existing rows; fingerprint-checked transfer): **176 LogicalAssetSource + 176 MediaAsset READY**. Read-only verification PASS: 176/176 mappings (current), 176/176 READY = catalog ids + genres, 7/7 genres, all R2 `syncbiz-media-prod`, 0 duplicates, 0 conflicts. 0 uploads, 0 deletes, PROD untouched. Rollback = delete exactly these 352 rows (owner approval). **Catalog ENABLED on TEST (owner-approved):** NEXT_PUBLIC_RFM_CATALOG_ENABLED=true + deploy `fe6166c9-014c-4cb1-85a3-c730d670ee65` (clean worktree 8239100 = app code of e7b3535; audio-player / device-player-context / playback-provider / ws-client / station-branch / RFM panel / media + authorize routes hash-identical); no PLAYER / DB / R2 / PROD change. /api/music-bank/authorize and /api/media without session/token → 401. Owner runtime tests pending.
- **⚠️ STATION MAP CHANGED BY OWNER 2026-10-11 (owner decision, explicit B1 codes) — `ACCEPTED — server-log corroborated`.** Pilot Branch (T001, legacy default, canonical 90d2b7b8) main station = **Dev-PC `dsk-9b11bfa1`** (beta.21; REPLACE code, 12:27:13Z designation_sync + MASTER "trusted station"). **The Lenovo `dsk-cbeb93d0` is NO LONGER the Pilot Branch MASTER**: it is the main station of **UNV-030 "יוניברס ראשל"צ- שמוטקין"** (canonical 41f94e5e, install code, 12:32:25Z MASTER; reconnect 12:44:29Z MASTER). BE אלעד UNV-094 = `dsk-644a7271`. Branch 071 "Be גן העיר-ת"א" + 092 "יש חסד": no station. Rollback of the Lenovo to Pilot Branch = a "Replace main station" code for T001 redeemed on the Lenovo after clearing its 030 designation (admin action). **New PARKED items:** (a) Control Room owner socket keeps the authorizedBranches of the token minted at page load → a branch created later shows Offline / is not commandable until F5 (PROVEN BY CODE: server/branch-room.ts ownerReceivesBranch; owner-attested F5 fixes it); (b) a station screen shows no Station ID / branch name (only MASTER + user name) — proposed header label.
- **STATION ACTIVATION B1 — RUNTIME 2026-10-11 (second computer, Windows user "Ori Sharon", durable `dsk-644a7271`, beta.21).** Activation UNV-094 (BE אלעד): `ACCEPTED — server-log corroborated` — code used once (0 failures), designation + StationDevice on 094, WS 11:27:24Z register MASTER in room c232f5fd + designation_sync; its screen joined the same room as CONTROL; the Lenovo stayed MASTER of its own branch (its 11:25 reconnect = owner closed/reopened VONO, before activation). URL playback on the new station after a VONO restart: `owner-attested 2026-10-11`. **NEW PLAYER DEFECTS found (PARKED — PLAYER frozen, audit needs owner approval), PROVEN BY RUNTIME (that computer's main.log):** (1) a LOCAL playlist whose files do not exist on the computer (YCD3) → every track fails in ms → renderer fail-forward + queue repeat = endless skip loop: 7,437 attempts in 35 min (≈3.5/s, 15 MB log, CPU) — never stops / never reports; can hit the Lenovo if its music folder is unavailable. (2) while that loop runs, a selected URL (MAIN URL session, attempt 1000000004…) is killed ~0.2 s later by the loop's next local PLAY_REQUEST (XFADE_ABORT new_crossfade_request; 5 of 7 URL starts) — the old local queue keeps ownership. Also known: local-file playlists are per computer by design (paths never leave the machine).
- **🟡 STATION ACTIVATION B1 — TEST candidate (2026-10-11), NOT yet accepted.** Head `e7b3535` (local, NOT pushed). **RENDERER + API** (no DB migration, no WS server change, **no MAIN / MPV / installer change** — beta.21 (src 65c13c0) already has saveConfig / connectCloud / applyDesktopAuth, PROVEN BY CODE). Deploy `f9e9525d-8cd5-4d41-b493-e44fc726286e` (= e7b3535, hashes identical incl. audio-player / device-player-context / playback-provider). Flow on a NEW computer: install beta.21 → owner login (B1 temporary) → "Activate this station" (Station ID + 6-digit code) → POST /api/stations/activate binds StationDevice + permanent designation of THAT branch only (code burned; 5 wrong tries lock; a computer that is the main station of another branch — the Lenovo — is refused; install never replaces, replace does) → MAIN saveConfig(branchId) + token for that branch + connectCloud → reload. **Audit (owner-requested):** the screen registered branch "default" hard-coded in ws-client (device + controller sockets) → playback / remote commands / jingle On-Air (PLAY_INTERRUPT via sendCommandToMaster) of a new station would have gone to the Lenovo. Fix = ONE identity `lib/station-branch.ts` (MAIN config branchId on desktop; "default" when never activated, in browsers / phones, on bridge error or after 3 s) used by both sockets; owner socket untouched. Lenovo registers "default" (PROVEN BY RUNTIME, TEST WS logs) → unchanged. PARKED (not playback routing): jingle pad board + AI playlist creation + LIBRARY_UPDATED push still use the legacy "default" content scope (shared board / content); music Schedules are workspace-wide and fire on every open screen (0 schedules on TEST); jingle schedules are per computer (localStorage). Tests: verify-station-activation 25/25 (throwaway DB), verify-renderer-ws-reconnect 31/31 (H regex adjusted to the new invariant, documented), verify-station-badge 17/17, branch-mgmt 27/27 pure. Next: B2 station credential (no owner login; Station Mode without Control Room / Access Control; admin sign-in cannot change Station ID / branch / main station / MASTER).
- **🟡 CONTROL ROOM — LIGHT OWN MAP (replaces Google Maps in the Control Room) — TEST candidate (2026-10-11), NOT yet accepted.** Head `e0dd756` (local, NOT pushed). **RENDERER ONLY** (Control Room only; no DB, no server, PLAYER / STATION untouched). Owner decision: full Google Maps = too much clutter. Control Room map = one small SVG: dark land silhouette bundled in `lib/control-room-land.ts` (Natural Earth 10m, public domain, Israel + Palestine as ONE shape, no internal borders, ~11 KB), branch markers only in status colors at stored lat/lng, **always the whole of Israel (follow-up `e32c007`, deploy `618e6e18`, hashes identical: the branch count never changes the zoom; owner 2026-10-11)**, click opens the branch, no tiles / roads / POI / labels / zoom-pan controls, zero network traffic. Add / Edit keeps Google Places Autocomplete (needs GOOGLE_MAPS_BROWSER_KEY: Maps JS + Places New) + server Place ID resolve (GOOGLE_MAPS_API_KEY); the preview is the same light map. GOOGLE_MAPS_MAP_ID no longer needed. `google-branch-map.tsx` deleted. Deploy `676aa009` (= e0dd756, hashes identical). Known limits: other countries have markers but no land shape yet (after presentation); the Eilat tip is coarse.
- **🟡 CONTROL ROOM — GOOGLE MAPS + LOCATION VIA GOOGLE PLACES — TEST candidate (2026-10-10), NOT yet accepted.** Head `fb08702` (local, NOT pushed). RENDERER + API + **DATABASE** (Control Room only). Map = Google Maps (browser key + dark Map ID read at runtime from /api/control-room/map-config), Advanced Markers in VONO status colors at stored lat/lng, click opens the branch, auto-fit to the organization's branches in any country; no key / Google fails → built-in map. Add / Edit = ONE Location field (Places Autocomplete; malls / centres valid) + map preview; the server resolves the picked Place ID with Google Places API (New) and the SERVER key and stores googlePlaceId, formattedAddress, city, country, lat/lng; unpicked text never saved; unconfirmed place = error. **Migration** `20261010180000_control_room_branch_place` (additive: Branch.googlePlaceId, Branch.formattedAddress) applied on TEST via the two-phase recipe: backup `D:\SyncBiz_Backups\test-env\20261010T203029Z-control-room-branch-place\` (SHA256 a16896a8…cf03, restore check PASS, counts 1|1|2|2|2|1|15|41) → deploy A `f0fa2dc1` (f77b1ba + migration folder) → migrate deploy (42 migrations; columns verified; data unchanged 2/2/2/1) → deploy B `9bf6ca2f-e82b-42f4-8da6-92248f0cd036` (= fb08702, hashes identical). Tests 47/47 (27 pure + 20 throwaway real DB). **Google keys NOT set on TEST yet** (GOOGLE_MAPS_API_KEY / GOOGLE_MAPS_BROWSER_KEY / GOOGLE_MAPS_MAP_ID absent) → built-in map, and Add Branch is blocked (no location without a Google-picked place) until the owner sets them. TEST had 2 branches at migration time (owner added one).
- **CONTROL ROOM 2026-10-10 follow-ups.** (1) The 15 DEMO-1xx demo branches were DELETED on TEST (owner-approved; dry run: 0 stations / designations / schedules / devices / scope / group / tag links; deleted their 15 default zones + branches in one transaction) → TEST has 1 branch (T001); the owner adds real branches himself. (2) `f77b1ba`: Google Geocoding used when the server has `GOOGLE_MAPS_API_KEY` (owner sets it in Railway; not set yet → Nominatim), same strict rules (ROOFTOP / RANGE_INTERPOLATED, no partial match, same house number + city). TEST app `52796d97-60d9-4d31-a59d-246173f08772` (geocode file hash-identical). After the presentation: map auto-fits each organization's country / branches (e.g. Italy), not a fixed Israel outline.
- **🟡 CONTROL ROOM STEP A — BRANCH MANAGEMENT — TEST candidate (2026-10-10), NOT yet accepted.** Head `a85cfd1` (local, NOT pushed). RENDERER + API + **DATABASE** (management side only; no player / station / WS change). Add / Edit branch (owner): name, branch number, country, city, street, house number → server geocoding (OpenStreetMap Nominatim, structured then free-text) accepted ONLY on the same house number AND the same city (no guessed location; live check caught "חיפה" → Hadera) → internal latitude / longitude → exact map position. Network code = Workspace.stationIdPrefix (globally unique, owner-set) → Station ID "<code>-<branch number>". Station activation: random 6-digit code, 60 min, single use, shown once, HMAC hash only, new code revokes the previous; "Replace main station" = new code (current station keeps playing; redemption = Step B, not built). **Migration** `20261010120000_control_room_branch_management` (additive) applied on TEST via the two-phase recipe: backup `D:\SyncBiz_Backups\test-env\20261010T193123Z-control-room-branch-mgmt\` (SHA256 0559071c…c49a, restore check PASS, counts identical) → deploy A `9512bc1a` (66d5a2c + migration folder) → migrate deploy (41 migrations; objects verified; data unchanged 16/16/2/1) → deploy B `d1c2d3d4-fd1d-4657-8a94-b53223b0afd3` (= a85cfd1, hashes identical). Tests: `scripts/verify-control-room-branch-mgmt.ts` 32/32 (16 pure + 16 on a throwaway real DB). Known limit: OpenStreetMap lacks many Israeli house numbers (e.g. Haifa Herzl 10) → such addresses are refused (owner decision pending: commercial geocoder). The 15 DEMO-1xx branches still exist (owner asked for no MORE demo data; deletion = separate decision).
- **CONTROL ROOM full width + page scroll (2026-10-09)** `66d5a2c` (owner screenshot: page could not scroll, box was centered) — /owner/control-room in the app shell full-width list + own scroll container. TEST app `e9a01d96-a597-4456-9d39-4f80681d3a2c` (app-shell / page hash-identical). RENDERER only.
- **🟡 CONTROL ROOM BROADCAST — TEST candidate (2026-10-09). Owner-attested 2026-10-09: Send from the Control Room played the jingle on the Lenovo (single station, Control Room opened on the SAME Lenovo). Multi-station broadcast NOT yet tested (needs a second station).** Head `645dffd` (local, NOT pushed). RENDERER + SERVER. Control Room → Broadcast → jingle (cloud library) → branches (one / several / All online; offline / needs-installation not selectable) → Send → per branch "Delivered to station" (handed to the station socket — NOT "played") / "Not delivered · reason". Station path = the existing accepted PLAY_INTERRUPT (duck → jingle → restore); station / player unchanged. Server: owner COMMAND with `requestId` → `COMMAND_DELIVERY` (instead of the socket-closing ERROR → one unavailable branch never stops the others); without requestId unchanged. Tests: new `server/verify-control-room-broadcast.ts` 14/14 + WS suites 139/139. TEST app `dd805da3-1c3b-4a55-ab27-f158ddd53c94` + TEST WS `357f1251-25b1-46b6-a182-4bbb9949a51e` (hashes identical; after the WS restart Lenovo MAIN re-registered MASTER + renderer CONTROL, PROVEN BY server log). WS rollback chain: 47e4b803 → 4ae850f6 → 23e94c01. Not yet runtime-tested by the owner. Schedule / automation = after the presentation.
- **🟡 CONTROL ROOM part 2 — ENTER A BRANCH + CONTROL — TEST candidate (2026-10-09), NOT yet accepted.** Head `b369185` (local, NOT pushed). RENDERER + SERVER info. Row / arrow / map dot → branch panel: now playing, Previous / Play-Pause / Next, volume (throttled SET_VOLUME), connected devices; offline / needs-installation → message, no controls. Commands via the EXISTING owner_global COMMAND path (branch authorisation → room's designated station → MAIN); no STOP / no raw URL. Server BRANCH_LIST gains info-only `devices[]` (role + kind, no ids). WS suites 139/139. TEST app `4f36cc84-6150-4502-bbe6-7c57e7d3bbeb` + TEST WS `47e4b803-869c-4cf8-bbdd-7f0d54fe8472` (hashes identical; after the WS restart Lenovo MAIN dsk-cbeb93d0 re-registered MASTER and its renderer CONTROL — PROVEN BY server log). WS rollback chain: 4ae850f6 → 23e94c01. Remote control not yet runtime-tested by the owner.
- **🟡 CONTROL ROOM part 1 — MAP + BRANCH LIST — TEST candidate (2026-10-09), NOT yet accepted.** Head `37dd4ac` (local, NOT pushed). RENDERER + API info field. Counters Branches / Online / Playing / Needs installation; map of Israel with one dot per branch by CITY (built-in English/Hebrew table, display-only outline); list sorted by status; row / dot selection. `GET /api/branches` adds info-only `hasStation` (no station → "Needs installation", never "Offline"). TEST app deployment `91a652f6-725a-4296-ae0c-a2331f5c6da1` (5 files hash-identical). **TEST DB demo data (owner-approved):** 15 demo branches (Haifa … Eilat, numbers 101–115, code `DEMO-1xx`, country IL, Asia/Jerusalem), each with the default Brand + one default "Main" Zone (same shape as addBranch); verified 16 branches / 0 default-zone problems / T001 untouched. **Remove after the presentation:** zones + branches WHERE workspaceId = TEST workspace AND code LIKE 'DEMO-%'. Note: TEST WorkspaceEntitlement.maxBranches = 1 but limits are NOT enforced on TEST (SYNCBIZ_ENFORCE_LIMITS unset). The TEST Pilot branch has no city yet (owner will provide) → no map dot until set.
- **🟡 CONTROL ROOM step 1 — ALL BRANCHES — TEST candidate (2026-10-09), NOT yet accepted.** Owner screenshot from the Lenovo 2026-10-09 (owner-attested): 1 branch / 1 online / 1 playing, "TEST Pilot Branch · Branch T001 · Playing · Computer". Latest `4c65bc2` (page moved OUTSIDE the workspace rails — full width, no library / playlists columns; same URL) = TEST app `1e9750d4-4099-41a7-a65f-2f2f7cda939b` (+ comment-only `66c5945`, not deployed). Before: `22401d9` (+ device type Computer / Streamer / Browser per branch, owner-approved SERVER change: BRANCH_LIST gains info-only `deviceType` + `canonicalBranchId` (from the station's routed room key; COMMAND routing unchanged); WS suites 139/139) = TEST app `2542689f-a7c6-40f0-95b0-ab4e13a46860` + **TEST WS `4ae850f6-5b1b-491e-809f-8fa56bfbd9fd`** (first WS change since `23e94c01` = WS rollback; hashes identical; Lenovo MAIN dsk-cbeb93d0 re-registered MASTER automatically, PROVEN BY server log). Before: `dcf6e6a` (+ branch number "Branch <locationCode>" under the name; GET /api/branches returns locationCode — additive) = TEST app deployment `c3f1e214-8283-4238-af76-9c0a1615f980` (view / store / types hash-identical). Before: `3cbc57a` (owner refinement: simple scalable list — name + Online/Offline + Playing/Not playing, song as secondary line, no artwork; chevron placeholder for the next step) = TEST app deployment `090403e9-7642-40e3-9497-bd6856df9527` (view hash-identical). First version (local, NOT
  pushed). RENDERER ONLY. `/owner/control-room` ("Control Room" in the menu): one card per DB branch + live status from
  the existing owner_global socket (Online/Offline, Playing/Paused/Not playing, title + artwork, counters). Read-only; no
  playback file changed. TEST app deployment `dc618344-80a9-4143-95be-e5fd2d3b8c9a` (clean worktree `14b6d24`; view /
  app-shell / ws-client hash-identical). Installer unchanged (beta.21). Known: a paused station shows "Waiting for status"
  until its next state update (server first-paint fix = separate approval).

- **✅ P0 PLAYBACK CONTINUITY + DROP NEXT + URL→URL MIX — ACCEPTED — owner-attested 2026-10-08 (Lenovo, beta.18 + TEST app 414d3564):** ~5 h continuous run, playback never stopped, Drop Next works, URL→URL mix works well. Not independently log-verified by Claude. OPEN before the playback baseline lock: real A/V video sync (built for future external-screen output) + restart restore (Gate 2d). Control Room waits for both. Candidate record:
- **🟡 P0 VIDEO V1 — SYNCED VIDEO (picture + sound from the SAME MPV player) — RUNTIME CANDIDATE ON TEST (2026-10-09),
  NOT yet accepted.** Head `65c13c0` (local, NOT pushed; on top of the Gate 2d candidate `943f23f`). DESKTOP MAIN +
  RENDERER. Owner-approved 2026-10-09 (MPV change). Opt-in per station, **OFF by default** (decks spawn with today's
  audio-only arguments). ON: the SYNC button next to Artwork/Video (player background = Video), then restart VONO
  (`C:\ProgramData\VONO\state\video-output.json`). Each music deck renders its picture in its own focus-less,
  taskbar-less MPV window placed by MAIN over the player's video slot (hidden otherwise / when VONO is minimized);
  crossfade = fade-through-black locked to the audio ramp; Auto quality 1080p → 720p → 480p → 360p (buffering stall /
  heavy dropped frames), back up after 3 clean songs; a stall drops the picture for the rest of THAT song only (audio
  untouched; the picture returns with the next load, never mid-song). The muted YouTube iframe is not mounted while
  synced video is active. V0 evidence + end-to-end run on the Dev-PC (PROVEN BY local runtime, not Lenovo): 1080p H.264
  d3d11va, 0 dropped frames; real crossfade A → black → B; per-deck audio advanced every second through load + mix,
  0 cache stalls. Known V1 limits: fade-through-black (a true dissolve needs a Windows helper — later); the picture is
  a native window always on top of the slot while VONO is visible (it can cover a menu that opens over the slot); the
  slot is the right 60% of the player's video area (no fog / rounded corner over the picture). main.log: `VIDEO_OUTPUT`,
  `VIDEO_OUTPUT_SET`, `VIDEO_QUALITY`, `VIDEO_STALL_DROP`. Tests: `desktop/scripts/verify-video-output.ts` 35/35.
  - **Desktop candidate:** `2.2.8-beta.21` (= Gate 2d + Video V1), SHA256
    `adced13e6f80e473a35fe4e2a57fe6449cdcc6bf6bb0a9f01e53abaa6e47316f`, 140,782,911 bytes, unsigned, NOT published,
    TEST-pinned, clean dist. Copy: `D:\SyncBiz_Backups\pilot\2026-10-09-beta21-video-v1-65c13c0\`.
  - **TEST app:** deployment `c11233f3-c90a-4f33-9e3b-472332dd9833` (= clean worktree `65c13c0`; audio-player /
    mpv-video-output / background / provider hash-identical). WS unchanged `23e94c01`. **Rollback:** beta.20 + app
    `1f66e7bf` (restart only), beta.18 + app `414d3564`.
- **🟡 P0 GATE 2d — RESTART RESTORE — RUNTIME CANDIDATE ON TEST (2026-10-09), NOT yet accepted.** Head `943f23f` (on top of
  `a41359f`; local, NOT pushed). DESKTOP MAIN + RENDERER. Owner rule 2026-10-09: the station remembers its last source (URL
  playlist or LOCAL) across shutdown / restart / crash with NO age limit, until changed manually. MAIN (designated station
  only) keeps `C:\ProgramData\VONO\state\playback-source.json` (URLs + titles only, never a local path). Boot: probe TEST
  `/api/health` (4 s). Online → MAIN restores the URL playlist at the remembered track + the Play Next queue. Offline →
  the renderer plays the station's last LOCAL session (no silence); once the app server answers twice 30 s apart the
  URL source is armed and takes over at the LOCAL track's mix point (crossfade, nothing cut). A user LOCAL choice / any
  URL selection replaces the pending restore. Renderer: waits for MAIN's decision; no 24 h TTL on a desktop station.
  **943f23f (owner rule: a failed URL restore → LOCAL, never silence):** until the restored URL has really played, a
  failure switches to LOCAL at once ("url-pending") and the URL is retried over LOCAL at its mix point; after 3 failures
  the URL is dropped ("url-failed") and LOCAL continues; no LOCAL music on the station → MAIN retries the URL after 25 s.
  Known limits: a fresh install has no saved source yet (first URL / LOCAL choice creates it); a Drop Next queue added
  during LOCAL is not remembered; after a give-up the URL is not retried until the next boot or a manual choice.
  main.log: `RESTORE_BOOT`, `RESTORE_URL_START`, `RESTORE_URL_PROVEN`, `RESTORE_URL_FAILOVER`, `RESTORE_URL_RETRY`,
  `RESTORE_URL_ARMED`, `RESTORE_URL_TAKEOVER`, `RESTORE_URL_GAVE_UP`, `RESTORE_CANCELLED`. Tests: `verify-restart-restore.ts` 49/49.
  - **Desktop candidate:** `2.2.8-beta.20`, SHA256 `b8b33708b34ee2bc1bee6f1929a60776b2fadf113c97e6dd5fd002ff7c89dabb`,
    140,777,798 bytes, unsigned, NOT published, TEST-pinned, clean dist. Copy: `D:\SyncBiz_Backups\pilot\2026-10-09-beta20-restore-fallback-943f23f\`.
    (beta.19 `9c0ae59c…` / app `3f0d6ac6` = superseded first 2d candidate, never installed.)
  - **TEST app:** deployment `1f66e7bf-f28c-4420-98ac-a00277cfcbed` (= clean worktree `943f23f`; provider / DPC / guard
    hash-identical). WS unchanged `23e94c01`. **Rollback:** beta.18 + app `414d3564`.
- **(accepted) 🟡 P0 DROP NEXT — RUNTIME CANDIDATE ON TEST (2026-10-08).** Head `e5b2029` (local, NOT pushed).
  Root cause: since a665e7c the station renderer is CONTROL → QUEUE_NEXT went to MAIN, which had no handler (silently
  dropped). Fix: MAIN owns the Play Next queue (URLs only; playlist → all tracks in order); the queue plays first (prepared
  + mixed like Gate 2c), then the playlist resumes where it stopped; during LOCAL the queued items play after the current
  LOCAL track and LOCAL resumes; MAIN NEXT / PREV for its own URL / queued items. main.log: `QUEUE_NEXT_ADDED`, `URL_NAV`.
  - **Desktop candidate:** `2.2.8-beta.18`, SHA256 `c358fa236e0cb6a7aa2ded4c4156522d6102202d1655863b74b5bd83f39bee60`,
    140,773,807 bytes, unsigned, NOT published, TEST-pinned, clean dist. Copy: `D:\SyncBiz_Backups\pilot\2026-10-08-beta18-dropnext-e5b2029\`.
  - **TEST app:** deployment `414d3564-359c-48d8-a678-01f4069d830a` (= clean worktree `e5b2029`; key files incl. F3a hash-identical).
    WS unchanged `23e94c01`. **Rollback:** beta.17 (Gate 2c accepted) + app `90d105f7`.

- **✅ P0 GATE 2c — NO SILENCE BETWEEN URL TRACKS — ACCEPTED — owner-attested 2026-10-08 (Lenovo, beta.17 + TEST app 90d105f7):** "now there is a mix, much better". Not independently log-verified by Claude. The mix length used is the user's saved setting (12 s on the Lenovo; default 9 s only when nothing is saved). OPEN (separate gates, not started): Drop Next (QUEUE_NEXT has no MAIN handler since a665e7c), video/audio sync (separate muted YouTube iframe, 2 s drift tolerance; MPV audio-only), restart restore (2d). Original candidate record:
- **(superseded) 🟡 P0 GATE 2c — RUNTIME CANDIDATE (2026-10-08).**
  Gate 2a runtime: owner reports continuous playback, no stops (owner-attested 2026-10-08; logs not inspected by
  Claude). Head `c135ba8` (local, NOT pushed): MAIN owns the AUTOMATIC progression of the URL session — next URL
  prepared PAUSED on the standby deck ~60 s before the end, handed over at the mix point (AUTOMIX on: mix length,
  default now 9 s; off: 1 s change at the end) through the existing readiness → ramp path; failures skip forward
  (cap 3) without touching the audible deck. Manual select / NEXT / PREV / jump unchanged. Restart restore (2d) NOT
  included. main.log markers: `XFADE_PREPARE`, `URL_AUTO_PREPARE`, `URL_AUTO_COMMIT`, `XFADE_BEGIN … prepared:true`.
  - **Desktop candidate:** `2.2.8-beta.17`, SHA256 `642dc7d718ccb8cd5a6439c503508fcef24cb2a3380742fd7f399dc65b6929de`,
    140,771,274 bytes, unsigned, NOT published, TEST-pinned (same transient edits, reverted), clean `desktop/dist`.
    Copy: `D:\SyncBiz_Backups\pilot\2026-10-08-beta17-gate2c-c135ba8\`.
  - **TEST app:** deployment `90d105f7-4322-4c85-8ddc-692c7a760311` (= clean worktree `c135ba8`; 9 key files incl. F3a
    hash-identical). WS unchanged `23e94c01`; DB unchanged.
  - **Rollbacks:** beta.16 + app `2536177a`; beta.12 accepted + app `4d2b0f53` (hashes re-verified 2026-10-08).

- **🟡 P0 GATE 2a — PARTIAL RISK-REDUCTION — RUNTIME CANDIDATE ON TEST, NOT YET ACCEPTED (2026-10-08).** Head `e31b614`
  on `playback/p0-gate1-url-transition` (local, NOT pushed): `610463c` (exact clicked track — Gate 1e regression on
  1-arg callers; URL end-of-playlist follows the loop setting with the LOCAL rule) + `e31b614` (a MAIN-started standby
  failure is reported once, then MAIN reports the still-audible deck again — orchestrator REPORTING-ONLY change,
  owner-approved; the previous session is handed back after "current music kept"). Does NOT solve renderer reload /
  URL preload / URL→URL crossfade / restart restore (Gates 2b–2d, architecture approved 2026-10-08, not started).
  - **Desktop candidate:** `2.2.8-beta.16`, SHA256 `dfb09b107ce676586ea5df04e43fd401961cd154708f5a821a240ca29274baef`,
    140,766,769 bytes, unsigned, NOT published, TEST-pinned (same transient edits, reverted), clean `desktop/dist`.
    Copy: `D:\SyncBiz_Backups\pilot\2026-10-08-beta16-gate2a-e31b614\`.
  - **TEST app:** deployment `2536177a-8b93-4e3d-b91a-7aa535c2a313` (= clean worktree `e31b614`; 10 key files incl. F3a
    `lib/location-filter.ts` + `prisma/schema.prisma` hash-identical). WS unchanged `23e94c01`; DB unchanged.
  - **Rollbacks:** beta.15 + app `048b920c`; beta.14 + app `4d6215d3`; beta.12 accepted + app `4d2b0f53` (all hashes
    re-verified 2026-10-08).

- **🟡 P0 GATE 1 (URL transitions) — RUNTIME CANDIDATE ON TEST, NOT YET ACCEPTED (2026-10-08).** Branch
  `playback/p0-gate1-url-transition` (local, NOT pushed) @ `4a0c3a4` on F3a baseline `31d02ad`: `33405e8` 1a (MAIN
  audible-deck protection) · `c2c43af` 1b+1c (URL failure → one safe next; one transition intent + Loading) · `51f9503`
  1d (remote NEXT/PREV exactly-once relay + mirrored `mpvAttemptId`) · `23ca85c` 1e (non-LOCAL PLAY_SOURCE must carry
  the exact track's URL — fixes the 2026-10-07 21:19 stack-click title/audio divergence) · `4a0c3a4` (test-only deploy
  fix). Beta.13 diagnostic NOT included.
  - **Desktop candidate:** `2.2.8-beta.14`, SHA256 `3ef4d0dab3978cb9d5ae03c9f32766ed719b177d487d0b2e9dddbd60c12edc34`,
    140,765,419 bytes, unsigned, NOT published, TEST-pinned (transient edits: hosted-url.ts → TEST app + TEST WS;
    normalizeEndpointsForPackaged → force TEST; version → 2.2.8-beta.14; all reverted). Built from a clean
    `desktop/dist` (stale beta.13 `mpv-diag.js` removed). Copy: `D:\SyncBiz_Backups\pilot\2026-10-08-beta14-gate1-4a0c3a4\`.
  - **TEST app:** deployment `4d6215d3-a077-4e88-b95c-c05f99827941` (= clean worktree `4a0c3a4`; 10 key files incl.
    F3a `lib/location-filter.ts` + `prisma/schema.prisma` hash-identical). Previous attempt `25771c1c` FAILED at the
    Next type check (test imported desktop `ws`) — never served. WS unchanged `23e94c01`; DB unchanged.
  - **Rollback:** Desktop beta.12 (`D:\SyncBiz_Backups\pilot\2026-10-07-beta12-p0-accepted\`, hash re-verified
    2026-10-08) + TEST app deployment `4d2b0f53` (F3a).
  - **Known limit (PARKED item 22):** after a renderer reload the old URL session is not restored into the new window →
    runtime acceptance starts by explicitly selecting a URL item once.
  - **SUPERSEDED for runtime by the Gate 1f candidate below (2026-10-08):** add `788eb5c` (1f MAIN: restore the audible
    session metadata after a failed / abandoned standby + read-only `mpvAttemptPending`) + `f033f5b` (1f renderer: the
    audible track stays "now playing" until the new one is ready; pending row / phone / badges = Loading; Loading ends
    at incoming readiness = XFADE_RAMP_START, or first real progress for a cold load). Head `f033f5b`.
  - **Desktop candidate:** `2.2.8-beta.15`, SHA256 `e064c912fe2706c2552e9cf429e1c5aaf2687d711c9c23fedca30a1a4ecb3e95`,
    140,766,604 bytes, unsigned, NOT published, TEST-pinned (same transient edits, reverted), clean `desktop/dist`
    (no mpv-diag). Copy: `D:\SyncBiz_Backups\pilot\2026-10-08-beta15-gate1f-f033f5b\`.
  - **TEST app:** deployment `048b920c-3c9f-43a5-95c8-232c716d952b` (= clean worktree `f033f5b`; 13 key files incl. all
    Gate 1f files + F3a `lib/location-filter.ts` + `prisma/schema.prisma` hash-identical). WS unchanged `23e94c01`.
  - **Rollbacks:** beta.14 (hash re-verified) + app `4d6215d3`; beta.12 accepted (hash re-verified) + app `4d2b0f53` (F3a).

- **⭐ P0 PLAYBACK HARDENING — ACCEPTED / BASELINE LOCKED (owner-attested 2026-10-07, TEST).** Desktop
  **2.2.8-beta.12** (SHA256 `3becd1c881c6c847f11c0c10f2f1549c7987be92bb1e83808b36cf8528e49429`) from `dc74457` +
  TEST renderer `3d6a70d` (deployment `a1028a7f`). Accepted commits `e78e8a0`, `3d6a70d`, `2e5b4b8`, `dc74457`
  on `feature/control-room-phase1` (pushed). Full record: `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md`. **No playback code change after this lock
  without a new isolated gate.** URL startup latency PARKED (§9 item 15).
- **Date:** 2026-10-07 (P0 lock); earlier: 2026-10-05 (jingles acceptance recorded 2026-10-06 UTC+3 night)
- **Phase:** PILOT HARDENING
  - **PLAYER PHASE: PILOT ACCEPTED** (owner-attested 2026-10-05)
  - **JINGLES / ANNOUNCEMENTS: PILOT ACCEPTED** (owner-attested 2026-10-05)
- **CONTROL ROOM F3a — LOCATION CLASSIFICATION FOUNDATION (SHADOW): ACCEPTED** (2026-10-07, TEST only) — clean commit
  `ca8312e` on `4fdd719`, app deployment `4d2b0f53`, migration `20261007200000_control_room_f3a_location_classification`.
  Region / LocationGroup / LocationTag + nullable Branch classification fields; MemberScope dimensions BRAND, LOCATION,
  ZONE, ZONE_TYPE, REGION, GROUP; **a Tag is NOT a permission dimension** (filter only). Canonical TEST branch
  locationCode = T001. The beta.13 playback diagnostic (`3ef27b8`) is NOT in this lineage. Record: `docs/CONTROL_ROOM_F3A_ACCEPTANCE_2026-10-07.md`.
- **⭐ P0 URL CONTINUITY + OWNERSHIP — ACCEPTED / LOCKED (2026-10-07, TEST, RENDERER ONLY)** — `8e8895a` (URL EOF →
  next URL) + `d617314` (stale LOCAL AUTOMIX can never take over a MAIN URL session); TEST app deployment `3f258faf`.
  **Current renderer / playback baseline = `d617314`** (Desktop stays 2.2.8-beta.12). Lenovo owner-attested with
  main.log evidence (EOF attempt 1000000001 → 283 ms → LOADFILE 1000000002 kind url; no LOCAL takeover). Record:
  `docs/P0_URL_CONTINUITY_OWNERSHIP_ACCEPTANCE_2026-10-07.md`. No playback change without a new isolated gate.
- **CONTROL ROOM F2a — MEMBER SCOPE FOUNDATION (SHADOW / OFFLINE): ACCEPTED** (2026-10-07, TEST only) — commit
  `398cce7`, app deployment `54f898f9`, migration `20261007150000_control_room_f2a_member_scope`. Scopes stored +
  evaluated OFFLINE only (nothing enforces / no request path reads them); TEST matrix 36/36 agree, 0 unexpected.
  **F2b NOT started.** Record: `docs/CONTROL_ROOM_F2A_ACCEPTANCE_2026-10-07.md`.
- **CONTROL ROOM F1 — BRAND + ZONE FOUNDATION (SHADOW): ACCEPTED** (2026-10-07, TEST only) — commit `25d4c06`, app
  deployment `538902e8`, migration `20261007120000_control_room_f1_brand_zone`. Default brand `11db397d…` (MAIN),
  default zone `6739408a…` (MAIN) on canonical branch `90d2b7b8…`. Nothing reads Brand/Zone at runtime yet. **F2 NOT
  started.** Record: `docs/CONTROL_ROOM_F1_ACCEPTANCE_2026-10-07.md`.
- **Current active P0:** none (P0 playback hardening accepted 2026-10-07). Next architecture step: Control Room
  **Foundation Gate — Brand + Zone + composite permission scopes** (blueprint `docs/CONTROL_ROOM_BLUEPRINT.md`,
  D14–D22; no schema/runtime work started).
- **CONTROL ROOM PHASE 1 — GATE 1 (canonical branch, SHADOW): FULL PASS / ACCEPTED** (2026-10-06, TEST only)
  on branch `feature/control-room-phase1` (NOT PR #52, which stays FROZEN at its accepted head). Gate 2
  (activation / "default" migration) NOT started. See §7 "CONTROL ROOM PHASE 1".
- **CONTROL ROOM GATE 2A-1 (identity/authorization compatibility): ACCEPTED** (2026-10-06, TEST only) —
  commit `2466820`, TEST app deployment `b6050fc1`. See §7 "GATE 2A-1".
- **CONTROL ROOM GATE 2A-2 (identity data migration): ACCEPTED** (2026-10-06, TEST only) — identity rows now on
  canonical branch `90d2b7b8…`. See §7 "GATE 2A-2".
- **CONTROL ROOM GATE 2A-3 (canonical WS room activation): ACCEPTED** (2026-10-06, TEST only) — commit
  `384df45`, WS deployment `23e94c01`. Live room is now `ws:31d30e23…:90d2b7b8…`; content rows still on
  "default". See §7 "GATE 2A-3".
- **CONTROL ROOM GATE 2B-1 (content branch compatibility): ACCEPTED** (2026-10-06, TEST only) — commit
  `9e06f40`, app deployment `8273a78b`. Content reads accept "default" + canonical; NEW content writes canonical;
  See §7 "GATE 2B-1".
- **CONTROL ROOM GATE 2B-2 (content data migration): ACCEPTED** (2026-10-06, TEST only) — all TEST content rows now
  on canonical `90d2b7b8…` (Playlist 6, JinglePadAssignment 4, Announcement 1; 0 on "default"). **GATE 2B
  COMPLETE.** See §7 "GATE 2B-2".
- **CONTROL ROOM GATE 3A (capability engine, SHADOW): ACCEPTED** (2026-10-06, TEST only) — commit `dd4ea6b`, app
  deployment `d02448b1`. Mode SHADOW (nothing enforced). See §7 "GATE 3A"; 3B items in §9 item 11.
- **CONTROL ROOM GATE 3B-1 (active-workspace isolation): ACCEPTED** (2026-10-06, TEST only) — commit `23ff679`, app
  deployment `062d3827`. Closes §9 items 11b + 11c. See §7 "GATE 3B-1".
- **CONTROL ROOM GATE 3B-2 (schedule cross-workspace IDOR): ACCEPTED** (2026-10-06, TEST only) — commit `cdebde5`,
  app deployment `d9d1dda5`. Closes §9 item 11a. See §7 "GATE 3B-2".
- **CONTROL ROOM GATE 3B-3 (user-management hardening): ACCEPTED** (2026-10-06, TEST only) — commit `c5ddf8b`, app
  deployment `85d08dca`. Closes §9 item 11e + the cross-workspace password / global-disable takeover paths;
  existing-user invite consent PARKED (§9 item 13). See §7 "GATE 3B-3".
- **CONTROL ROOM GATE 3B-4a (retire dead / legacy command routes): ACCEPTED** (2026-10-06, TEST only) — commit
  `2cb46d2`, app deployment `f8d3bc55`. Closes the command-route part of §9 item 11d (announcements / logs /
  metadata-proxy remain for 3B-4b..d). Authz mode still SHADOW. **Gate 3B-4b NOT started.** See §7 "GATE 3B-4a".
- **PR #52:** OPEN — **NOT MERGED / DO NOT MERGE** without explicit approval
- **PROD:** UNTOUCHED
- **Written from:** Dev-PC (`dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608`) — no direct Lenovo log access.

## 2. GIT

| Item | Value |
|---|---|
| Repository | `D:\APP Project\syncbiz-app` |
| Branch | `fix/local-playback-designated-master-prb` |
| PR | #52 — OPEN / NOT MERGED |
| **CURRENT PR HEAD** | the **docs-only** commit `docs(pilot): accept Jingles and beta.10 runtime baseline`, whose parent is `cd4c631`. A commit cannot contain its own SHA — read it with `git rev-parse origin/fix/local-playback-designated-master-prb`. |
| **RENDERER + MAIN APPLICATION BASELINE** | `cd4c631fc90570f062040def825f0c91bcff5bc3` — accepted application/runtime source (player phase `2ebdbe4` + jingles P0) |
| **DESKTOP beta.10 SOURCE LINEAGE** | `cd4c631fc90570f062040def825f0c91bcff5bc3` + documented temporary TEST build pins (see §5) |
| **DESKTOP AUTHORITATIVE ARTIFACT** | `2.2.8-beta.10`, SHA256 `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| main / PR base | `951a44cd99f39d921e217d246f6422b49cee2941` (verified after fresh fetch) |
| Working tree when written | clean at `cd4c631` (before this docs-only commit) |
| Stash present | `stash@{0}` = `pr52-xfade-diag-hold` (temporary diagnostic, see §9) |

Meaning: `cd4c631` is the exact application/runtime source accepted for the pilot (renderer AND desktop
MAIN). Everything above it is **documentation only**. **No application source changed after `cd4c631`.**
Verify with `git diff --stat cd4c631..origin/fix/local-playback-designated-master-prb`.
Lineage: `865ba81` (offline cold boot, MAIN) → `2ebdbe4` (renderer stall fix) → `17a1b84` (docs) →
`cd4c631` (jingles: MAIN PLAY_INTERRUPT + Preview safety).

## 3. TEST ENVIRONMENT

| Item | Value |
|---|---|
| Railway project | `syncbiz-pr52-test` |
| Renderer (app) | https://syncbiz-app-test-production.up.railway.app (HTTP 200; `/api/health` status ok, database ok, yt-dlp ok) |
| WS | wss://syncbiz-ws-test-production.up.railway.app |
| Renderer Railway deployment ID | `b591c130-4112-433a-a928-6f0f424a5dce` (SUCCESS, 2026-10-06 00:26:49 +03:00) |
| Renderer image digest | `sha256:4b1e5ef4414f399869f1e72b2002ea09dad63eaa6992bee6f7b3c2f75cad4b11` |
| TEST DB | Postgres inside `syncbiz-pr52-test` (test secrets stored outside the repo — never here) |
| **ElevenLabs** | `ELEVENLABS_API_KEY` configured on `syncbiz-app-test` by the owner (verified by NAME only; value never read) |
| **App volume** | `syncbiz-app-test-volume` (id `4272e7c6-1518-436d-9da0-1fe1c7c5e54f`) attached to `syncbiz-app-test` only, mount path **`/data`**; Railway exposes `RAILWAY_VOLUME_MOUNT_PATH=/data` |
| **Jingle storage** | generated MP3s under **`/data/jingles/<uuid>.mp3`**, served at `/api/jingles/audio/<uuid>` |
| **WS volume (2026-10-06)** | `syncbiz-ws-test-volume` (id `18b32178-da30-484f-8403-785b347baf73`) on `syncbiz-ws-test` only, mount `/data` → designation / lease / branch-alias state in `/data/ws-lease/` (proven to survive redeploy with no re-assertion) |
| **Control Room Phase 1 deploys (2026-10-06)** | app `87a05469-b3f5-4afc-819a-c33746e0182e` (source `6b5b9a0`, file-hash verified for the changed renderer files); WS `335dad0a-e3a4-4802-b1b6-c9ae40697e51` (Gate 1 shadow code `cea1585`) |
| **TEST DB backup before Gate 2B-2** | `D:\SyncBiz_Backups\test-env\20261006T145008Z-gate2b2\` (pg_dump sha256 `d6a5c882ceef7808ea62310db113b82f8f95e8ba370c7d6004bcff813fb1dbb7`, 241240 B; **restore test PASS** — 13 counts identical, throwaway DB dropped) + `gate2b2-manifest.json` (sha256 `f6893d7050a0813c6921a6d8a8164ade31a57786765daf3dd8d2416e644d494b`; also on TEST app volume `/data/control-room/gate2b2-manifest.json`) + `BACKUP-RECORD.txt`. Git HEAD at backup `2d2ccdf` |
| **Control Room F3a deploys (2026-10-07)** | deploy A `71cfcb1c-cecc-4811-bdbb-85de9fffcec4` (= `4fdd719` + F3a migration folder only → `prisma migrate deploy`); deploy B **`4d2b0f53-2361-4401-9c92-5034c99e97e1`** (= `ca8312e`, clean tree, hash-verified; playback renderer files identical to `d617314`). WS NOT redeployed (`23e94c01`) |
| **TEST DB backup before F3a** | `D:\SyncBiz_Backups\test-env\20261007T195345Z-control-room-f3a\` (pg_dump sha256 `fcdf6a4a458e0791e6f27be9272c3d481aab357508791136cbe838a700dd8db7`; **restore test PASS**; pre/post fingerprints) |
| **P0 URL continuity + ownership deploy (2026-10-07)** | app **`3f258faf-d90b-4f5d-8bbf-d2246e7aec8b`** (= `d617314`, incl. `8e8895a`; clean tree; changed renderer files hash-verified). WS / desktop / DB unchanged |
| **Control Room F2a deploys (2026-10-07)** | deploy A `8a9e36f9-1526-4f04-9858-5938e629581a` (= `25d4c06` + F2a migration folder only → `prisma migrate deploy`); deploy B **`54f898f9-bd3c-4267-ba42-5b3edad36a8f`** (= `398cce7`, clean tree, hash-verified). WS NOT redeployed (`23e94c01`) |
| **TEST DB backup before F2a** | `D:\SyncBiz_Backups\test-env\20261007T104212Z-control-room-f2a\` (pg_dump sha256 `c2b8d7edd03ec011bb3876707c8d67c1daaf7ffc974fa132de3842286ad9c5b7`; **restore test PASS**; pre/post fingerprints) |
| **Control Room F1 deploys (2026-10-07)** | deploy A `bbb98798-8487-4e43-b308-a101b34e402c` (= `483fd28` + F1 migration folder only → `prisma migrate deploy`); deploy B **`538902e8-439d-46c4-a38d-ea978c7baaac`** (= `25d4c06`, clean tree, changed files hash-verified). WS NOT redeployed (`23e94c01`) |
| **TEST DB backup before F1** | `D:\SyncBiz_Backups\test-env\20261007T094829Z-control-room-f1\` (pg_dump sha256 `4d9ea2da808c4fa19bdb0f63d40ea4ae72ccfb5564ea63dd7fd81bcf0e2bc22b`; **restore test PASS**; pre/post fingerprints) |
| **Gate 2B-1 app deploy (2026-10-06)** | app `8273a78b-8b93-476a-9625-6d4983717d05` (SUCCESS 14:13Z; source `9e06f40`, clean tree; all 12 changed source files hash-verified). WS NOT redeployed |
| **Gate 2A-3 WS deploy (2026-10-06)** | WS `23e94c01-38ba-4dde-9f22-336bb304bdde` (SUCCESS 11:37Z; source `384df45`, clean tree). Previous shadow WS build `335dad0a…` = rollback reference (rollback also needs the legacy WS files from the Gate 2A backup) |
| **Canonical TEST branch** | `90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2`, code `T001`, "TEST Pilot Branch (legacy default)", `legacyKey="default"`; **since Gate 2A-3 the WS routes the TEST workspace by this canonical id** (clients still send `"default"`; content rows still `"default"` until Gate 2B) |
| **Gate 2A-1 deploy (2026-10-06)** | app `b6050fc1-e762-49d1-af2d-b4f6677abc8d` (SUCCESS 10:10Z; source `2466820`, all 9 changed files hash-verified: live = working tree, LF-normalized = commit). WS NOT redeployed (still `335dad0a…`) |
| **TEST DB backup before Gate 2A** | `D:\SyncBiz_Backups\test-env\20261006T100051Z-gate2a\` (pg_dump sha256 `aff8197d9b048f121fc81e8c4c58a69246136e800affa7aede4307c3c429fc46`; **restore test PASS** — row counts matched, throwaway DB dropped) + WS designation / lease / alias file copies (hashed); `BACKUP-RECORD.txt` inside. Git HEAD at backup `273f042` |
| **TEST DB backup before Gate 1** | `D:\SyncBiz_Backups\test-env\20261006T050718Z-control-room-gate1\` (pg_dump sha256 `a0a65c1d…d13e`, restore-verified) + WS state file copies |

**PROD untouched.** No PROD deploy, DB, WS, variable, volume or installer action in this baseline.

## 4. LENOVO PILOT STATION

| Item | Value | Evidence |
|---|---|---|
| durableDeviceId | `dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f` | server-log corroborated (TEST WS REGISTER) |
| branch | `default` | server-log corroborated |
| workspace (TEST) | `31d30e23-8f4a-4bf2-a1df-c707b69b5673` | verified 2026-10-06 from the TEST DB (`BranchMasterDesignation`) + TEST WS designation file (`ws:31d30e23-…:default`) |
| workspace (PROD — not this pilot env) | `f2366813-341d-46ba-a6b8-92d2c1fd39b1` | PROD designation of the same Lenovo (2026-10-02); earlier versions of this file wrongly listed it as the TEST workspace — corrected 2026-10-06 |
| Installed Desktop | `2.2.8-beta.12` (since 2026-10-07; before: beta.10) | **OWNER-ATTESTED / NOT DIRECTLY VERIFIED FROM THIS MACHINE** |
| Embedded renderer WS id | `ba8ffdba-d00b-468d-bf74-f805013d37ef` (CONTROL) | server-log corroborated (earlier sessions) |

## 5. DESKTOP INSTALLER (ACCEPTED)

### CURRENT — `2.2.8-beta.12` (P0 playback hardening, accepted owner-attested 2026-10-07)

| Item | Value |
|---|---|
| Version | `2.2.8-beta.12` |
| Desktop source lineage | `dc744575e97279358e6794687ed37d408706677d` (branch `feature/control-room-phase1`) |
| Artifact | `SyncBiz-Player-Setup-2.2.8-beta.12-x64.exe` |
| SHA256 | `3becd1c881c6c847f11c0c10f2f1549c7987be92bb1e83808b36cf8528e49429` |
| Size | 140,772,149 bytes · unsigned · **NOT published** · **TEST-pinned** |
| Transient build edits (reverted) | `hosted-url.ts` → TEST app + TEST WS; `normalizeEndpointsForPackaged` → force TEST endpoints; `desktop/package.json` version → `2.2.8-beta.12` |
| Accepted copy | `D:\SyncBiz_Backups\pilot\2026-10-07-beta12-p0-accepted\` (hash verified) · candidate copy `…\2026-10-07-beta12-dc74457\` |
| Details | `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md` |

### PREVIOUS — `2.2.8-beta.10` (jingles baseline; now a rollback reference)

| Item | Value |
|---|---|
| Version | `2.2.8-beta.10` |
| Desktop source lineage | `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| Artifact | `SyncBiz-Player-Setup-2.2.8-beta.10-x64.exe` |
| SHA256 | `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| Size | 140,769,315 bytes |
| Environment | **TEST-pinned** |
| Signing | unsigned |
| Published | **NO** |
| Accepted copy | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-accepted\` (+ `SHA256.txt`, `README.txt`; hash verified) |
| Candidate copy (kept) | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-candidate\` |
| Older rollback artifacts | beta.9 — `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\`; beta.8 — `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (see §13) |

**Important:** beta.10 was built from `cd4c631` **plus temporary TEST pin edits**, reverted after the
build: `desktop/src/main/hosted-url.ts` → TEST app + TEST WS; `normalizeEndpointsForPackaged` → force
TEST endpoints on every packaged load; `desktop/package.json` version → `2.2.8-beta.10`.
Packaged `app.asar` verified: version beta.10; TEST app/WS only (0 PROD hosts on executable lines);
`case "PLAY_INTERRUPT"` + `resolveInterruptUrl` compiled; beta.9 offline renderer cache present.
**`cd4c631` alone cannot reproduce the binary — the artifact hash is authoritative.** Committed
`hosted-url.ts` points at PROD.

## 6. RENDERER

| Item | Value |
|---|---|
| Accepted renderer source | `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| Railway deployment ID | `b591c130-4112-433a-a928-6f0f424a5dce` |
| Deploy method | `railway up` from a **clean** working tree (Railway metadata carries no commit hash) |

**Verification (2026-10-06, read-only, `railway ssh` into the TEST container):** deployed
`components/jingles-control/JinglesShell.tsx` byte-identical to `cd4c631`; `components/audio-player.tsx`
unchanged since `2ebdbe4` (byte-identical). Jingle MP3s on `/data` survived this redeploy.
**Confidence:** source verified at file-hash level for the changed files; exact commit-to-deploy linkage
**NOT CRYPTOGRAPHICALLY PROVEN** (no commit hash in Railway metadata).

## 7. RUNTIME ACCEPTED

### CONTROL ROOM F3a — LOCATION CLASSIFICATION FOUNDATION (SHADOW) — ACCEPTED (2026-10-07, TEST, branch `feature/control-room-phase1`)

- **Server / DB corroborated** after the owner's normal VONO reopen (~20:03Z): desktop token 200 ×2, ws-token 200 ×3,
  register 200 ×3; MAIN MASTER (trusted station) + renderer CONTROL in canonical room `ws:31d30e23…:90d2b7b8…`; 0 × 409; no
  branch conflict. F3a check ok; locationCode backfill T001 (second run NO-OP); F1 ok; F2a matrix 36/36 (0 unexpected);
  fingerprint 0 diffs in 18 groups (only approved change: locationCode); no Region / Group / Tag / fake rows.
- Commit `ca8312e` · tag `pilot-baseline/2026-10-07-control-room-f3a-ca8312e` · details `docs/CONTROL_ROOM_F3A_ACCEPTANCE_2026-10-07.md`.

### P0 URL CONTINUITY + OWNERSHIP — ACCEPTED — owner-attested 2026-10-07 (Lenovo, beta.12 + TEST renderer `d617314`)

- **Owner-attested (main.log values supplied by the owner):** LOCAL queue present in the background; URL attempt
  1000000001 played with no LOCAL takeover; `MPV_ENDFILE reason:"eof" attemptId:1000000001` → 283 ms →
  `MPV_LOADFILE attemptId:1000000002 kind:"url"`. URL ownership PASS · URL EOF → next URL PASS · LOCAL takeover
  BLOCKED · duplicate load NONE. Earlier: saved YouTube album auto-advanced URL → URL with no manual NEXT.
- **Server-log corroborated:** MAIN MASTER (trusted station) + renderer CONTROL in canonical room; 0 × 409.
- Commits `8e8895a` + `d617314` · tag `pilot-baseline/2026-10-07-renderer-d617314` · details `docs/P0_URL_CONTINUITY_OWNERSHIP_ACCEPTANCE_2026-10-07.md`.

### CONTROL ROOM F2a — MEMBER SCOPE FOUNDATION (SHADOW / OFFLINE) — ACCEPTED (2026-10-07, TEST, branch `feature/control-room-phase1`)

- **Server / DB corroborated:** after the owner's normal exit + reopen — desktop token 200 ×2, ws-token 200 ×2, register
  200 ×3; durable id `dsk-cbeb93d0…` unchanged; MAIN MASTER (10:51:31Z, trusted station) and renderer CONTROL in canonical
  room `ws:31d30e23…:90d2b7b8…`; 0 × 409; only 5xx = 2 × pre-existing music-bank 503. MemberScope check ok (1 row:
  ADMIN + allLocations); matrix 36/36 agree, 0 unexpected; F1 check ok; fingerprint 0 diffs (18 groups).
- Static: evaluator imported by nothing in app / lib / server / desktop; `lib/authz.ts` / `shadowAuthorize`, token, WS,
  station and desktop files unchanged vs F1.
- Commit `398cce7` · tag `pilot-baseline/2026-10-07-control-room-f2a-398cce7` · details `docs/CONTROL_ROOM_F2A_ACCEPTANCE_2026-10-07.md`.

### CONTROL ROOM F1 — BRAND + ZONE FOUNDATION (SHADOW) — ACCEPTED (2026-10-07, TEST, branch `feature/control-room-phase1`)

- **Server / DB corroborated:** Lenovo MAIN MASTER (10:03:04Z, trusted station) and renderer CONTROL in canonical room
  `ws:31d30e23…:90d2b7b8…`; canonical branch → default brand MAIN; exactly one default zone MAIN; both stations + the
  Lenovo designation resolve to it; no Branch id "default"; no fake station / designation rows; content fingerprint
  0 diffs vs pre-migration; desktop token / register / ws-token 200, 0 × 409; F1 check `ok`; second backfill = no-op.
- **Owner-attested (Lenovo, beta.12):** token/register PASS, durable station id preserved, MAIN MASTER, renderer CONTROL,
  LOCAL / LOCAL NEXT / URL PASS, no 409, no branch conflict, no watchdog restart.
- Commit `25d4c06` · tag `pilot-baseline/2026-10-07-control-room-f1-25d4c06` · details `docs/CONTROL_ROOM_F1_ACCEPTANCE_2026-10-07.md`.

### P0 PLAYBACK HARDENING — ACCEPTED — owner-attested 2026-10-07 (Lenovo, Desktop beta.12 + TEST renderer `3d6a70d`)

Accepted on the Lenovo (Dotan; this Dev-PC session did not inspect Lenovo logs): correct URL trackIndex · URL
NEXT/PREV queue coherence · no LOCAL contamination during a URL session · fresh MAIN attemptId per WS load · watchdog
does not falsely restart during slow URL resolution · recovery kill cancellation · source-aware URL load timeouts ·
crossfade does not start on duration alone · stream crossfade waits for real MPV progress · coreIdle /
pausedForCache gating · outgoing audio audible during long URL buffering · promotion volume + pause normalization ·
URL → LOCAL · LOCAL NEXT after URL · LOCAL automatic transition · no playback gap · no watchdog restart · no force kill.
Server-verified (read-only, 2026-10-07): live TEST renderer files hash-identical to `3d6a70d`.
Commits `e78e8a0` (RENDERER ONLY) · `3d6a70d` (test) · `2e5b4b8` (DESKTOP MAIN + WATCHDOG) · `dc74457` (DESKTOP MAIN).
Tags `pilot-baseline/2026-10-07-desktop-beta12-dc74457`, `pilot-baseline/2026-10-07-renderer-3d6a70d`.
Root causes / fixes: §8 and `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md`.

### CONTROL ROOM GATE 3B-4a — RETIRE DEAD / LEGACY COMMAND ROUTES — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`2cb46d2`** (APP only, security): `/api/player/commands` (GET, POST), `/api/play-now` (POST),
  `/api/commands/play-local` (POST), `/api/commands/stop-local` (POST), `/api/agent/commands` (GET) → **410 Gone**
  (`{"error":"Gone"}`) and nothing else: no process execution (`cmd /c start` / `taskkill`), no agent-queue drain, no
  in-memory player-state mutation, no global-log write, no console echo of request target / path / device. The route
  files import only `next/server`. Legacy UI callers (fire-and-forget) left unchanged.
- Audit basis (3B-4): these routes were unauthenticated; `play-local` / `player/commands` wrote client-supplied targets
  (possibly LOCAL paths) to the global log served by the anonymous `/api/logs` and to the server console; on Linux they
  never executed (Windows-only guard); `play-now` was dead; nothing enqueued agent commands.
- Tests: `scripts/verify-gate3b4a-retired-routes.ts` 14/14 (runtime 410s, exec spies, queue / player-state / global-log
  intact, zero console output, no echo; static imports; jingles/audio + jingles/bell untouched; authz SHADOW) + full
  regression matrix (22 suites) + typecheck + `next build` PASS.
- TEST app deployment `f8d3bc55` (5 retired files + jingles/audio + jingles/bell hash-verified).
- **Runtime — server-log corroborated:** across **1,629 TEST HTTP requests (19:38:44Z → 19:47:34Z)** covering three VONO
  reopens and the URL test: **zero hits on any retired route, zero 410s**; `/api/jingles/audio/:id` and
  `/api/jingles/bell/*` 200 from the beta.10 player; MAIN MASTER (19:40:21Z, 19:41:07Z, 19:47:04Z) + renderer CONTROL in
  the canonical room; no 403 / 409 / branch_conflict. URL playback makes no app-API playback call (renderer → WS →
  MAIN → MPV). The two `POST /api/music-bank/authorize` 503s are pre-existing TEST configuration ("not configured").
- **ACCEPTED — owner-attested 2026-10-06:** VONO reopen; MASTER badge; LOCAL; URL playlist play; URL NEXT; URL → LOCAL;
  On-Air over URL; pads + playlists; Access Control; no visible error.
- Observation recorded separately: excessive `/api/schedules` polling (§9 item 14).
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3B-3 — USER-MANAGEMENT HARDENING — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`c5ddf8b`** (APP only, security): closes §9 item 11e (MANAGER → OWNER escalation) and the two takeover
  paths found in its audit.
  - `requireWorkspaceAdmin()` (WORKSPACE_ADMIN or SUPER_ADMIN membership, ACTIVE, in the ACTIVE workspace) replaces
    `requireAdmin` on `admin/users` GET / POST / PATCH / DELETE and pause- / resume- / remove-member. **MANAGER
    (HQ_CONTROL) → 403** on all of them, incl. the user list. `admin/audit` unchanged (separate product decision).
  - Rank / ownership rules (`lib/admin/user-management-policy.ts`): only the **Workspace Owner** (or platform
    SUPER_ADMIN) creates / promotes / modifies / pauses / resumes / removes another WORKSPACE_ADMIN; a non-owner admin
    manages lower ranks only; the **owner row can never be demoted / paused / removed / disabled** (no implicit
    ownership transfer); the **last active admin cannot be demoted**.
  - **Global password:** PATCH `newPassword` only for self or a platform SUPER_ADMIN; a workspace invite never sets or
    changes an existing user's global password → **cross-workspace password takeover FIXED**.
  - **Global disable** (`DELETE` → `User.status`): platform SUPER_ADMIN only → **tenant global-disable takeover
    FIXED**; workspace-level removal stays on remove-member.
- Audit proof (pre-fix, real handlers over a fake workspace): MANAGER could create / promote / self-promote to
  WORKSPACE_ADMIN, demote the owner, reset the owner's password, pause / remove / globally disable admins; any admin
  could invite an existing user from another workspace and overwrite their global password. Post-fix
  `scripts/verify-gate3b3-user-management.ts` 45/45 (MANAGER / non-owner admin / owner / platform / takeover chains /
  last admin / existing guards / static). Full regression matrix (21 suites) + typecheck + `next build` PASS.
- TEST app deployment `85d08dca` (all 6 changed files hash-verified).
- **Runtime (regression only; no TEST user created / edited / paused / removed / disabled / password-changed):**
  server-log corroborated VONO reopen 19:06:55Z → MAIN MASTER 19:06:56Z + renderer CONTROL 19:06:58Z in the canonical
  room; token mint normal; no 401 / 403 / 409 / branch_conflict. TEST DB: 1 user (ACTIVE), 1 membership
  (WORKSPACE_ADMIN / ACTIVE) — unchanged.
- **ACCEPTED — owner-attested 2026-10-06:** Access Control loads and lists users; VONO reopened; MASTER badge; LOCAL;
  On-Air; pads + playlists normal; no visible error. Privilege protections accepted from the focused test.
- Existing-user invite consent remains **PARKED** (§9 item 13).
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3B-2 — SCHEDULE CROSS-WORKSPACE IDOR — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`cdebde5`** (APP only, security): closes §9 item 11a.
  - GET / PATCH / DELETE `/api/schedules/[id]` load the schedule ONLY from the active session workspace via new
    `db.findScheduleInWorkspace` (id + workspaceId in the query; fails closed; resolved like the list/create routes).
    Not found or another workspace → **404** BEFORE any owner wildcard / branch / alias logic (existence not revealed).
    The "log mismatch and fall through" path is removed.
  - Writes are workspace-bound: `updateSchedule` / `deleteSchedule` require the workspace and use `updateMany` /
    `deleteMany` where `{ id, workspaceId }`; 0 rows → 404 (no check/write race). The fail-open `getSchedule` path is
    not used.
  - Same-workspace behavior unchanged (owner / admin, branch user incl. legacy alias, 403 on unassigned branch, 401
    without session). List / create routes, target validation, browser schedule execution and 3A shadow hooks
    untouched.
- Audit proof (pre-fix, real handlers over a fake two-workspace DB): OWNER of A could GET / PATCH (rename) / DELETE
  Schedule B (all 200). Post-fix `scripts/verify-gate3b2-schedule-idor.ts` 19/19: cross-workspace GET / PATCH / DELETE
  → **404** with Schedule B unchanged (incl. legacy "default" branch user and B canonical branch); same-workspace 200;
  unknown id 404; no session 401; unassigned branch 403; no id-only write executed. Full regression matrix (20 suites)
  + typecheck + `next build` PASS.
- TEST app deployment `d9d1dda5` (both changed files hash-verified).
- **Runtime (regression only, by owner decision — no Schedule row created, to keep §9 item 9 out of this gate):**
  server-log corroborated VONO reopen 18:35:22Z → MAIN MASTER 18:35:32Z + renderer CONTROL 18:35:36Z in the canonical
  room; token mint normal; no 401 / 403 / 409 / branch_conflict. TEST DB still 0 Schedule rows, 1 Branch row.
- **ACCEPTED — owner-attested 2026-10-06:** VONO opened normally; MASTER badge; LOCAL; On-Air; pads + playlists
  normal; Access Control loads; no visible error. Cross-workspace behavior accepted from the focused test.
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3B-1 — ACTIVE-WORKSPACE ISOLATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`23ff679`** (APP only, security): closes the primary-workspace privilege leak (§9 11b) and the bearer
  workspace drift (§9 11c).
  - Auth helpers take the ACTIVE workspace explicitly (`hasBranchAccess`, `hasTenantAdminRole`,
    `getAccessTypeForUser`, `getAssignedBranchIdsForUser`, `isOwner`, `isBranchUser`, `requireBranchAccess`);
    `requireAdmin` uses the session user's `tenantId`; missing workspace → fail closed. All 20 route call sites pass
    `user.tenantId`.
  - `getTenantRole` with an explicit workspace: membership role or **null** (no primary fallback); a non-member gets no
    branches (never the implicit "default").
  - Bearer API auth: `verifyWsTokenClaims` (token format unchanged) → user resolved in the token's **signed**
    workspace + `enforceTokenWorkspaceScope`; **missing workspace claim → DENY**; non-member workspace → DENY.
  - `lib/playlist-access.ts` fallback (no active workspace) → **403 fail closed**.
- Audit proof (pre-fix, real helpers over a fake two-workspace DB): ADMIN in primary A + CONTROLLER/VIEWER in active B
  had `requireAdmin` / `isOwner` / `"*"` / any-branch access in B. Post-fix (`scripts/verify-gate3b1-active-workspace.ts`
  33/33, real signed cookies + tokens): all DENY in B; reverse case (admin only in active workspace) now correctly
  ALLOW; inverse / no-membership / bearer cases fail closed; single-workspace behavior unchanged. Full regression
  matrix (19 suites) + typecheck + `next build` PASS.
- TEST app deployment `062d3827` (all 16 changed files hash-verified).
- **Runtime — server-log / DB corroborated:** VONO reopen 18:01:20Z → MAIN MASTER + renderer CONTROL 18:01:40Z in the
  canonical room; token mint normal; `playlists/[id]:PUT` ×3 succeeded (content.manage ALLOW, workspace `31d30e23…`);
  no 401 / 403 / 409 / branch_conflict / `bearer_missing_workspace`. Branch-master: unauthenticated GET → 401; TEST
  owner membership WORKSPACE_ADMIN / ACTIVE (single membership) → `isOwner(user, activeWs)` true; Gate 3A shadow
  `master.designate` ALLOW; designation intact. (Owner-session GET not exercised — accepted by owner.)
- **ACCEPTED — owner-attested 2026-10-06:** VONO opened normally; MASTER badge; LOCAL; On-Air; pads visible;
  playlists visible + editable; Access Control loads; no visible error (screenshot).
- No DB / schema / WS / desktop change; authz mode **SHADOW**. **PROD untouched.**

### CONTROL ROOM GATE 3A — CAPABILITY ENGINE (SHADOW) — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`dd4ea6b`** (APP only): `lib/authz.ts` = ONE centralized `authorize(subject, capability, branchIds)`
  resolved from the **ACTIVE SESSION WORKSPACE only** (no primary-workspace fallback; no membership / SUSPENDED →
  DENY). Mode code constant OFF | SHADOW | ENFORCE = **SHADOW**.
- Capabilities: playback.control, announcement.send, schedule.edit, users.manage, master.designate, monitoring.view,
  campaign.manage, branches.manage, **content.manage (new)**. Locked presets (owner decisions 2026-10-06): SUPER_ADMIN /
  WORKSPACE_ADMIN → ADMIN (all); **MANAGER → HQ_CONTROL** (ALL scope; operational + content; no users / master /
  branches); REGIONAL_MANAGER operational (branch-scoped until a region model); BRANCH_MANAGER (incl. all API-created
  BRANCH_CONTROLLER rows) → playback + announcement + monitoring; VIEW_ONLY / VIEWER → monitoring only. Legacy
  "default" ≡ canonical only inside the workspace.
- Shadow hooks (fire-and-forget, never awaited, never block; placed after each route's existing gate): playback
  (`playlists/play`), schedules, admin users / members, branch-master, branches, content (playlists, sources, radio,
  AI build, add-from-catalog, jingle pads / library / generate) + would-be capability summary at the 3 token mint
  routes. Structured `[VONO authz] shadow` log with safe identifiers only.
- Tests: `scripts/verify-gate3a-authz.ts` 36/36 (ADMIN / HQ / REGIONAL / BRANCH / VIEW presets, scope, active
  workspace vs primary, cross-workspace / cross-branch DENY, fail closed, shadow never blocks / never throws, safe
  logging, hook coverage) + full regression matrix (18 suites). Typecheck + `next build` PASS.
- TEST app deployment `d02448b1` (all 24 changed files hash-verified).
- **Runtime — server-log / DB corroborated:** active workspace `31d30e23…` on every decision; token-mint summaries
  (preset ADMIN: playback / announcement / monitoring / master.designate ALLOW); **content.manage ALLOW** observed for
  `playlists/[id]:PUT` ×4, `jingles/generate:POST` ×2, `jingles/library:POST`, `jingles/pads:POST` (new pad
  `pad-meat` created **canonical**, no duplicate pad); no unexpected DENY; no 403 / 409 / branch_conflict; MAIN MASTER
  + renderer CONTROL unchanged in the canonical room; nothing blocked. Not exercised at runtime (test-proven only):
  schedule.edit, users.manage, branches.manage, existing-pad update-in-place.
- **ACCEPTED — owner-attested 2026-10-06:** normal VONO use (reopen, playlist playback, On-Air, pad save outside
  fullscreen) with no behavior change.
- No DB / schema / WS / desktop change; nothing enforced. **PROD untouched.**

### CONTROL ROOM GATE 2B-2 — CONTENT DATA MIGRATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`) — GATE 2B COMPLETE
- Script **`scripts/control-room/migrate-content-2b2.mjs`** (commit `bb6a4d2`; exact file executed on TEST, sha256
  `8d19a2ee…f29c`): dry-run / apply / reverse; explicit workspace + canonical args (refuses "system"); exact
  expected counts; pad-conflict fail-safe (no merge / delete / guess); exact-id updates in ONE transaction; manifest
  (table, id, old/new branch, content fingerprint) written before apply; post-apply fingerprint proof; out-of-scope
  fingerprint guard; idempotent; reverse by manifest ids only.
- Pre-flight PASS (2B-1 app `8273a78b` + 2A-3 WS `23e94c01` live; MAIN MASTER + renderer CONTROL canonical; no
  conflict / 409 / 403; no pad under both aliases). Backup + restore test PASS (see §3).
- **Dry-run → APPLIED ~14:51Z** (workspace `31d30e23…` only), "default" → canonical: Playlist 5
  (`1f260a23`, `75b76942`, `99085b78`, `a0d1c99f`, `c9e3d568`), JinglePadAssignment 3 (`2e87dc9a` pad-birthday,
  `308291f2` pad-promo, `abaaa0d8` pad-closing), Announcement 1 (`114e5d7f`), Source 0, Schedule 0. Second apply =
  NO-OP. All row ids preserved; content fingerprints identical (only branchId / updatedAt changed); no unrelated
  row changed (identity tables + PlaybackIncident telemetry untouched).
- **Result: Playlist 6, JinglePadAssignment 4, Announcement 1 — all canonical; Source 0; Schedule 0; zero intended
  content rows on "default"; no duplicate pads** (pad-birthday, pad-bread, pad-closing, pad-promo).
- **Runtime — server-log / DB corroborated:** full VONO restart 14:55:28Z → MAIN `dsk-cbeb93d0` **MASTER** 14:55:37Z
  (`stationBranchMatchesRoom: true`), renderer **CONTROL** 14:55:40Z, both in `ws:31d30e23…:90d2b7b8…`; no 403 /
  409 / branch_conflict / error lines (app + WS); no content recreated on "default".
- **ACCEPTED — owner-attested 2026-10-06:** VONO opened normally; MASTER correct; LOCAL resumed and playing; all
  pads and playlists visible; jingles / On-Air work; no visible error.
- **Rollback not required. PROD untouched.**

### CONTROL ROOM GATE 2B-1 — CONTENT BRANCH COMPATIBILITY — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`9e06f40`** (APP only; no DB migration, no desktop, no WS server, no playback change): legacy "default" ≡
  workspace canonical branch (same-workspace alias only) for content.
  - Jingle pads (`app/api/jingles/pads/route.ts` + `lib/jingle-pad-compat.ts`): read from either alias; update the
    row that already represents the pad (no duplicate); new pads canonical; a pad under BOTH aliases = conflict
    (GET reports `conflicts`, POST 409; never guessed); concurrent first-create race handled.
  - Canonical writes at the store layer: playlists (`lib/playlist-store.ts`, null stays null; covers AI build /
    generation), sources (`lib/store.ts addSource`), radio (`lib/radio-store.ts`, canonicalized before the Branch
    upsert → no stub for the migrated workspace), jingle library.
  - `lib/playlist-access.ts` zero-assignment fallback = {default + canonical} only.
  - `lib/schedule-target-validator.ts` alias-aware for SOURCE / PLAYLIST / RADIO (caller workspace).
  - `lib/broadcast-library-updated.ts`: a canonical branch is sent to the WS as its legacy key ("default") so existing
    clients (registered with "default") still receive LIBRARY_UPDATED — no WS change.
  - Tests: `scripts/verify-gate2b1-content-compat.ts` 36/36 (real helpers / pad flows / notification over an
    in-memory fake DB) + full regression matrix (17 suites); the 2A-1 content-route guard was updated to the
    documented 2B-1 rule. Typecheck + `next build` PASS.
- TEST app deployment `8273a78b` (hash-verified). After deploy, before owner activity: Playlist 5 / Pads 3 /
  Announcement 1 all still "default".
- **Runtime — DB / server-log corroborated:** VONO reopen 14:21:17Z → MAIN MASTER + renderer CONTROL in the
  canonical room 14:21:47Z. Legacy rows untouched (3 pads, 5 playlists, 1 announcement — timestamps unchanged).
  New pad `pad-bread` (`e43d1bc7…`, 14:24:58Z) = **canonical**; new playlist **"YCD3"** (`a623406d…`, 14:26:00Z) =
  **canonical**. No pad under both aliases (no duplicate). No 409 / 403 / conflict / error lines. Three jingles
  generated (audio files only); none saved to the jingle library, so no new Announcement row.
- **ACCEPTED — owner-attested 2026-10-06:** VONO reopened with the new hosted renderer; 3 legacy pads + 5 legacy
  playlists visible; Bread pad and YCD3 still visible after a full VONO reopen (mixed legacy + canonical reads);
  On-Air works.
- NOT PROVEN by runtime: LIBRARY_UPDATED delivery (the WS does not log it) — proven by test/code only.
- Current TEST content state (intentionally mixed until Gate 2B-2): Playlist 5 "default" + 1 canonical;
  JinglePadAssignment 3 "default" + 1 canonical; Announcement 1 "default".
- **PROD untouched.**

### CONTROL ROOM GATE 2A-3 — CANONICAL WS ROOM ACTIVATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`384df45`** (SERVER / WS only: `server/branch-alias.ts`, `server/index.ts`, `server/ws-token.ts` + tests):
  alias mode ACTIVE (code constant); raw `"default"` resolves to the canonical branch for ROOM routing (device +
  controller REGISTER, owner COMMAND target, internal designation sync); connections keep the raw branchId
  (client messages / content unchanged); boot re-key BEFORE listen of designation / tombstone / lease keys
  `ws:<ws>:default` → `ws:<ws>:<canonical>` with the same values (fail safe on conflict: workspace stays on raw
  room); an active alias cannot be changed at runtime (409). `stationBranchId` read for evidence logging only.
  No playback / renderer / desktop / app / content change. Tests: `server/verify-gate2a3-activation.ts` 34/34
  (real-process boot re-key) + full regression matrix (16 suites); Gate 1 / 2A-1 static asserts updated from
  "shadow" to the documented 2A-3 behavior.
- Pre-flight PASS (backups + WS files byte-identical to the Gate 2A backup, identity canonical, Lenovo MASTER in
  `:default`). One content difference found and explained: owner-created `pad-birthday` (10:58:12Z, owner-confirmed),
  left on "default" for Gate 2B.
- **WS deploy `23e94c01` (one controlled restart, Lenovo untouched) — server-log corroborated:** boot re-key
  `rekeyed` + persisted 11:37:49Z before listen; workspace active. MAIN `dsk-cbeb93d0` → **MASTER** ("trusted
  station") and renderer → **CONTROL** at 11:38:09Z in **`ws:31d30e23-8f4a-4bf2-a1df-c707b69b5673:90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2`**;
  persisted designation + lease = canonical room → Lenovo, **zero `:default` keys**; alias file unchanged.
- **`stationBranchId` — PROVEN BY RUNTIME** (first runtime use): station REGISTER carries
  `stationBranchId=90d2b7b8…`, `stationBranchMatchesRoom: true`. **`stationDeviceId` preserved** (trusted-station MASTER).
- Resilience (each server-log corroborated: MAIN MASTER + renderer CONTROL in the canonical room, no `:default`
  MASTER, no branch_conflict / 409 / revoke / promote / duplicate MASTER):
  - **VONO restart PASS** — close 11:46:11Z → MASTER 11:46:18Z, renderer CONTROL 11:46:20Z.
  - **Clean unattended Windows reboot PASS** — disconnect 12:07:55Z → MASTER 12:09:36Z, renderer 12:09:37Z.
  - **Internet outage / recovery PASS** — disconnect 13:01:26Z (~2 m 50 s offline, past the 90 s timeout) →
    renderer CONTROL 13:04:16Z, MAIN MASTER 13:04:25Z; automatic.
- **ACCEPTED — owner-attested 2026-10-06:** LOCAL normal, MASTER badge correct, On-Air works after activation and
  VONO restart; clean reboot: VONO autostarted via watchdog, LOCAL auto-resumed, ~10 min clean, no login/action;
  outage: **music did not stop, skip or restart; MASTER badge stayed visible throughout**.
- The heavy-load freeze self-heal event (first reboot attempt / later remote session + Claude on the Lenovo) is
  NOT a Gate 2A-3 issue — PARKED item 0c (separate audit).
- **PROD untouched.**

### CONTROL ROOM GATE 2A-2 — IDENTITY DATA MIGRATION — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Script **`scripts/control-room/migrate-identity-2a2.mjs`** (commit `c54c8b2`; exact file executed on TEST,
  sha256 `8e930499…a256`): dry-run / apply / reverse, explicit workspace + canonical args, exact expected counts,
  collision checks, exact-id updates in one transaction, manifest written before apply, idempotent.
- Preconditions re-confirmed immediately before apply: canonical Branch `90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2`
  (T001, `legacyKey="default"`) exists; counts 1/2/1; no target collisions; WS alias SHADOW, effective `:default`;
  WS state files byte-identical to the Gate 2A backup; Lenovo MASTER in `:default`.
- **Dry-run PASS** → **APPLIED ~10:52Z** (workspace `31d30e23…` only), "default" → canonical:
  - BranchMasterDesignation ×1 (`36880080-6638-4a48-9ee6-4b9a77a50523`, Lenovo `dsk-cbeb93d0`)
  - StationDevice ×2 (`1d8e7c6d-6968-42b2-97cc-d6d9ed2b07da` Lenovo `dsk-cbeb93d0`; `20f2cf18-b0ca-4d07-9368-bea0d135f685` Dev-PC `dsk-9b11bfa1`)
  - UserBranchAssignment ×1 (`a3924506-7872-43c4-a7de-6e9fdd98b281`)
  - Second apply = NO-OP (idempotent).
- **Content rows NOT migrated** (still on "default", unchanged: Playlist 5, JinglePadAssignment 2,
  Announcement 1, Source 0) — Gate 2B.
- **Manifest** (reverse source): TEST app volume `/data/control-room/gate2a2-manifest.json` + local copy
  `D:\SyncBiz_Backups\test-env\20261006T100051Z-gate2a\gate2a2-manifest.json`, sha256
  `b3e750bdafb294475fe616908ccacacd818b68b00d8a69ab69704eff7d5e48c6`. Reverse:
  `--reverse --manifest=<path>` (canonical → "default", exact ids).
- **WS NOT restarted; effective room still `ws:31d30e23…:default`**; WS state files unchanged.
- **Compatibility rule PROVEN BY RUNTIME** (Lenovo VONO restart after migration, server-log/DB corroborated):
  MAIN closed 11:07:52Z → **MASTER** 11:08:12Z ("permanent designation -> MASTER (trusted station)") in `:default`;
  renderer **CONTROL** 11:08:15Z in `:default`; Lenovo StationDevice refreshed 11:08:13.899Z with `branchId`
  still canonical (stored row not moved; pre-2A-1 code would have returned branch_conflict). **No
  branch_conflict, no 409, no error lines.** `stationDeviceId` preserved (trusted-station MASTER requires it).
- **ACCEPTED — owner-attested 2026-10-06:** auto reopen without login PASS; MASTER badge PASS; LOCAL resumed
  automatically PASS; On-Air announcement (PLAY_INTERRUPT) PASS; nothing looked wrong.
- **Rollback not required. PROD untouched.**
- `stationBranchId` remains **PROVEN BY CODE / TEST ONLY**; its first runtime use is Gate 2A-3.
- Cosmetic, not a blocker: StationDevice `lastSeenAt` is `@updatedAt`, so the migration bumped the Dev-PC row
  to 10:52:33Z.

### CONTROL ROOM GATE 2A-1 — IDENTITY COMPATIBILITY — ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commit **`2466820`** (SERVER / app API only): legacy `"default"` ≡ the workspace's canonical branch
  (same-workspace alias only) for StationDevice binding and branch-authorization comparisons; the stored
  StationDevice row is never moved; real branch/workspace conflicts unchanged; desktop token gains additive
  signed `stationBranchId` (only together with `stationDeviceId`). WS server untouched; content resolver and
  WS alias remain **shadow**; no Playlist / Jingle / Announcement / Source / schedule change; no protected
  playback file changed. Test `scripts/verify-gate2a-identity-compat.ts` 25/25 + full regression matrix + build.
- TEST app deployment `b6050fc1` (hash-verified). Backup verified + restore test PASS (see §3).
- **Server-log corroborated** (Lenovo VONO restart after deploy): MAIN `dsk-cbeb93d0` closed 10:26:57Z →
  **MASTER** 10:27:17Z ("permanent designation -> MASTER (trusted station)"), renderer `ba8ffdba` **CONTROL**
  10:27:17Z, both in `ws:31d30e23…:default`; renderer bind (`devices-register`, `ws-token`) ran on the new code
  at 10:27:20Z; **no 409 / no branch_conflict / no error** lines since deploy.
- **`stationDeviceId` preserved — PROVEN BY RUNTIME** (trusted-station MASTER requires the token's station binding).
- **`stationBranchId` — PROVEN BY CODE / TEST ONLY** at this stage (not logged; not consumed until 2A-3).
- **ACCEPTED — owner-attested 2026-10-06:** MASTER badge PASS; LOCAL resumed automatically PASS;
  On-Air (PLAY_INTERRUPT) PASS; nothing looked wrong.
- **PROD untouched.**
- **KNOWN CAVEAT (expected):** the alias-equivalence path is NOT exercised by runtime until the StationDevice
  row moves to the canonical branch in Gate 2A-2 (pre-migration the row is still `"default"`, so no conflict
  was possible). **First mandatory acceptance check after the 2A-2 migration:** Lenovo VONO restart →
  MAIN still MASTER, renderer CONTROL, `stationDeviceId` present, no 409 / branch_conflict.

### CONTROL ROOM PHASE 1 — GATE 1 — FULL PASS / ACCEPTED (2026-10-06, TEST, branch `feature/control-room-phase1`)
- Commits: `cea1585` (Gate 1 shadow: `Branch.legacyKey`, app resolver + WS alias map, mode = code constant
  "shadow"), `c3a14aa` (docs: TEST workspace id), **`6b5b9a0` (renderer zero-touch WS reconnect — isolated,
  cherry-pickable; preserved at local branch `fix/renderer-zero-touch-ws-reconnect`)**.
- **Server-log corroborated:** shadow resolves raw `default` → candidate `90d2b7b8…` with **effective `default`**,
  room `ws:31d30e23…:default` (no routing change); designation / lease / alias survive WS redeploy with no
  re-assertion; after a WS restart with nobody touching the Lenovo, MAIN `dsk-cbeb93d0` → MASTER (08:38:27.707
  UTC) and renderer `ba8ffdba` → CONTROL (08:38:28.044 UTC) in the same `:default` room; a TEST CONTROL saw
  MASTER + CONTROL online and its PLAY_INTERRUPT was delivered with no error.
- **ACCEPTED — owner-attested 2026-10-06:** renderer reconnect fix (automatic, no focus/interaction);
  PLAY_INTERRUPT from TEST CONTROL heard (duck → announcement → music resumed); LOCAL playback stable throughout.

### MASTER / CONTROL USER-FACING STATUS — ACCEPTED — owner-attested 2026-10-06
- Commit **`284ff66`** (renderer/display only, `feature/control-room-phase1`, pushed): the designated station
  shows GREEN "MASTER · Playing store audio" (from the existing `canLocalExec`, exposed read-only as
  `isDesignatedAudioStation`); never CONTROL / Standalone there; other devices unchanged (blue CONTROL).
  TEST deploy `5116757e-04a9-4f75-9fe5-77c408c051b8` (changed files file-hash verified).
- Owner-attested on the Lenovo: header GREEN MASTER, "Playing store audio" visible, music continues normally.
- **Server-log corroborated:** after the reload the renderer `ba8ffdba` still registers **CONTROL**
  ("embedded renderer -> CONTROL") and MAIN `dsk-cbeb93d0` **MASTER** ("permanent designation") — the
  internal WS roles are unchanged.

### JINGLES / ANNOUNCEMENTS — ACCEPTED — owner-attested 2026-10-05 (Lenovo beta.10 + TEST renderer `cd4c631`)
- Announcement Generate works in TEST.
- Generated MP3 is persisted on the Railway volume.
- On-Air from CONTROL reaches the designated Lenovo MASTER.
- Music ducks.
- Announcement plays.
- Music resumes automatically.
- LOCAL queue/session remains intact.
- Preview cannot broadcast accidentally.

### JINGLES — independently verified by Claude (TEST server, 2026-10-06)
- One TEST generate via the real API (owner-signed-in throwaway profile): HTTP 200, `audio/mpeg`, valid
  MP3 (35,152 B); file present at `/data/jingles/91361cb7-e1cf-48e4-8db8-6d542d34f516.mp3`; survived a
  container restart (PID 1 restarted after the file was written) and the later `b591c130` redeploy.

### PLAYER PHASE — ACCEPTED — owner-attested 2026-10-05 (beta.9 + renderer `2ebdbe4`, still in force)
1. LOCAL normal playback works.
2. AUTOMIX natural LOCAL → LOCAL works.
3. Manual NEXT LOCAL → LOCAL crossfade works.
4. SEEK works.
5. Watchdog: closing VONO causes it to return automatically.
6. Windows reboot WITH internet: VONO returns and playback resumes.
7. Windows cold boot WITHOUT internet: VONO starts automatically and LOCAL playback resumes
   automatically without user action.
8. Internet returns after offline cold boot: playback continues smoothly — no stop, restart or track jump.
9. Heavy system load: no deck clear, no permanent stop; playback continued.

### Earlier acceptance still in force (2026-10-05, beta.8 + `bfd3a49` — see §13)
URL playback, LOCAL ↔ URL handoffs, metadata handoff, localSync flood fix, MAIN WS auto-reconnect,
no reconnect-paced skips / false EOF / stop / restart, URL control after reconnect — owner-attested;
designated MASTER re-registration + renderer CONTROL + no auto-failover — server-log corroborated.

## 8. ROOT CAUSES FIXED

### P0 PLAYBACK HARDENING — FIXED + runtime accepted (owner-attested 2026-10-07) — details in `docs/P0_PLAYBACK_HARDENING_ACCEPTANCE_2026-10-07.md`
- **Wrong URL item / LOCAL contamination** (`e78e8a0`): PLAY_SOURCE sent without the item's trackIndex (→ 0); on the
  designated station URL-session NEXT/PREV ran against the local queue. Fixed: index passed; `transportRunsLocally()`
  routing; URL NEXT/PREV = PLAY_SOURCE N±1.
- **Watchdog vs slow URL resolution** (`2e5b4b8`): WS loads reused attemptId 0 → resolving URL judged stalled after
  ~13 s → kill/restart. Fixed: fresh MAIN attemptId per WS load; shared stall predicate for state + kill abort;
  120 s startup hard max; kill cancellation on recovered health; source-aware standby windows (LOCAL 12 s / stream
  30 s / yt-dlp 90 s).
- **Crossfade before the incoming URL was audible** (`dc74457`): ramp started on "playing + duration known". Fixed:
  stream incoming requires real time-pos progress ∧ ¬coreIdle ∧ ¬pausedForCache; promotion re-asserts volume +
  pause=false; global MPV status semantics unchanged.

### JINGLES / ANNOUNCEMENTS — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Generate failed on TEST:** `ELEVENLABS_API_KEY` missing on `syncbiz-app-test` (route returned 503
  before any TTS) → configured by the owner. No persistent app volume (files lost on redeploy) → `/data`
  volume attached; files now under `/data/jingles`.
- **On-Air never reached the designated station:** since PR #50 the branch MASTER is Electron MAIN, and
  MAIN's `routeToOrchestrator` dropped `PLAY_INTERRUPT` (`default: break`). **Fix (`cd4c631`, desktop
  MAIN → beta.10):** additive `case "PLAY_INTERRUPT"` → `interruptUrlsForPayload` / `resolveInterruptUrl`
  (relative server paths resolve against the configured app origin; https kept; local / UNC / `file:` /
  `local://` / other schemes rejected; optional pre-roll bell) → existing `orchestrator.playInterrupt`
  (duck → play once → restore). No orchestrator / music channel / session / designation change.
- **Desktop "Preview" was actually On-Air:** **Fix (`cd4c631`, renderer):** Preview separated from
  On-Air. Browser/mobile Preview is local-only (unchanged). In the Electron app (Chromium audio muted)
  Preview is disabled/unavailable with a clear tooltip instead of broadcasting. On-Air is an explicit
  separate `📡 On-Air` button that routes to the designated MASTER.

### OFFLINE COLD BOOT — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** hosted renderer unavailable offline → renderer-owned restore never ran; MAIN station WS
  depended on the renderer; dead Retry.
- **Fix (`865ba81`):** same-origin last-known-good renderer cache + MAIN WS startup connect + Retry fix.

### STALL / SESSION DESTRUCTION — FIXED + runtime accepted (owner-attested 2026-10-05)
- **Cause:** LOCAL 4-second startup backstop called `stop()` → destroyed source/playlist/queue + recovery snapshot.
- **Fix (`2ebdbe4`):** backstop enters the existing bounded startup recovery instead of `stop()`.

## 9. PARKED / NON-BLOCKING

Not pilot blockers. Do not fix inside unrelated work.
0. ~~User-facing MASTER/CONTROL badge~~ — **RESOLVED 2026-10-06** (commit `284ff66`, see §7). Branch
   code/name in the badge still deferred to the canonical-branch work (Gate 2 / Control Room).
0b. **BLOCKER BEFORE A SECOND TEST BRANCH (pre-multi-branch):** the embedded renderer still activates with
   branch `"default"` from MAIN's config; its branch must come from its co-located trusted Station/MAIN
   binding. Separate audited fix — NOT part of Gate 2A.
0c. **PLAYBACK HARDENING — freeze self-heal REDISPATCH (recorded 2026-10-06, separate audit/approval required).**
   Observed during the first Gate 2A-3 Windows-reboot test on the Lenovo. Classification from the Lenovo-local
   audit (owner-provided; this Dev-PC session did not inspect the Lenovo logs): NOT caused by Gate 2A-3
   canonical routing; MAIN / MPV / renderer did not crash or reload; session/queue preserved; the earlier
   destructive startup-stall bug did NOT recur; the event was the existing bounded freeze self-heal reacting to
   a system-wide stall (Claude was opened shortly before the stall — causation NOT proven). Two issues:
   1. freeze REDISPATCH reloads the same LOCAL track from position 0 (loses the playback position);
   2. the freeze timer is not reset on PLAYING_CONFIRMED, which allows a redundant REDISPATCH.
   **Do NOT implement during Gate 2A-3.** Needs its own AUDIT → root cause → approval. Protected playback
   baseline stays unchanged until then. The Gate 2A-3 reboot test is repeated as a CLEAN unattended test
   (no Claude, no extra apps, no interaction, wait 2–3 min after LOCAL starts).
1. **Jingle schedules are still localStorage-only** (`components/jingles-control/schedule-storage.ts` +
   `JingleScheduleAutoPlayer`): each device fires only its own schedules while that client is open.
   **Must move to a central/server-side model during Control Room.**
2. **Multi-branch broadcast not implemented yet** (server fan-out to several rooms + delivery/ack).
3. **Mobile TEST login/user issue** — separate authentication/control task.
4. **Playback recovery snapshot 24-hour TTL — REAL PILOT FOLLOW-UP.** `RECOVERY_TTL_MS` (24h) in
   `lib/playback-provider.tsx`: a station powered off >24h may not auto-resume. Record only.
5. **Explicit kill-`mpv.exe` resilience test** — manual destructive test not yet run (code path regression-tested).
6. **Missing/corrupt LOCAL file runtime acceptance** — manual test not yet run (code path regression-tested).
7. **STARTUP QUEUE HYDRATION (UI / session restore — NON-P0, recorded 2026-10-06, re-observed 2026-10-07 after F1).**
   After a VONO cold start / reopen: LOCAL audio resumes correctly and the current track plays correctly, but the
   visible playlist / queue can stay empty and NEXT is unavailable at first; after the first natural track transition
   the full LOCAL queue appears and NEXT works. **Desired:** startup restore hydrates the visible queue / session
   immediately, **without restarting or redispatching the currently playing track.** NOT a playback-continuity P0;
   not caused by F1. Own audit / gate; do NOT change playback for it now.
8. **ACTIVE PLAYLIST VISUAL INDICATOR (UI, recorded 2026-10-06).** The UI previously showed which playlist was
   actively playing (especially URL playlists) with an animated LED / snake-style border around the playlist
   artwork. Owner wants an obvious "currently playing playlist" indication restored later. Not a pilot blocker.
   Separate audit later; no UI redesign now.
9. **Branch stub creation (found in the Gate 2B audit, 2026-10-06).** `lib/store.ts` (addSchedule / addDevice) and
   `lib/radio-store.ts` upsert a Branch row whose **id** is the raw branch key (e.g. id `"default"`, `update: {}`);
   Branch.id is global, so a second workspace would link to the first workspace's stub. Not present in TEST
   (0 Schedule / Device rows; radio now canonicalizes first). Separate audit; not part of Gate 2B.
10. **Generic `/api/announcements` POST (found in Gate 2B-1).** Unauthenticated, stores `workspaceId: "system"`,
   so its branch cannot be canonicalized safely; left unchanged in 2B-1. Jingle announcements use the
   authenticated `/api/jingles/library` (canonical). Separate audit.
11. **GATE 3B SECURITY-HARDENING ITEMS (authorization audit 2026-10-06; recorded in Gate 3A, NOT fixed).** All
   PROVEN BY CODE; present in the shared code (PROD has the same code paths). Each a separate audited fix in 3B:
   a. ~~**Schedule cross-workspace IDOR**~~ — **FIXED in Gate 3B-2 (`cdebde5`, TEST)**. Was: `schedules/[id]` looked
      up by global id; workspace mismatch only logged; any workspace OWNER passed via `"*"`.
   b. ~~**Primary-workspace drift**~~ — **FIXED in Gate 3B-1 (`23ff679`, TEST)**. Was: `hasBranchAccess` /
      `getAssignedBranchIdsForUser` / `requireAdmin` / `isOwner` resolved the user's PRIMARY workspace;
      `getTenantRole` fell back to the primary membership.
   c. ~~**Bearer token workspace drift**~~ — **FIXED in Gate 3B-1 (`23ff679`, TEST)**. Was: `getCurrentUserFromApiRequest`
      dropped the token's signed workspace.
   d. **Unauthenticated mutating routes** — PARTIALLY FIXED. ~~`player/commands`, `play-now`, `commands/play-local`,
      `commands/stop-local`, `agent/commands`~~ → **retired to 410 in Gate 3B-4a (`2cb46d2`, TEST)**. Still open (per
      the 3B-4 audit split): `announcements` GET/POST (3B-4b), `logs` (3B-4c), metadata / proxy routes incl. SSRF on
      `radio/metadata` + `sources/parse-url` and anonymous yt-dlp (3B-4d). `jingles/audio/[id]` + `jingles/bell/*`
      must stay URL-playable for MAIN On-Air.
   e. ~~**MANAGER → OWNER escalation**~~ — **FIXED in Gate 3B-3 (`c5ddf8b`, TEST)**, together with the cross-workspace
      global-password takeover and tenant global-disable takeover found in its audit. Was: `admin/users` POST/PATCH
      accepted `accessType:"OWNER"` with no caller-rank check (MANAGER passed `requireAdmin`).
   f. **Client-chosen `owner_global`** — WS REGISTER accepts any role from the client (`server/index.ts:686`).
   g. **WS COMMAND capability bypass** — no role/capability check on COMMAND (`server/index.ts:1532-1573`); MAIN
      executes any relayed command; non-designated branches allow browser MASTER election.
   h. **Workspace-wide announcements** — GET returns all workspaces; POST writes workspace `"system"`.
   i. **Guest session-code scope** — session codes are not workspace-scoped.
12. **FULLSCREEN MODALS (UI, recorded 2026-10-06; owner-observed on the Lenovo).** In fullscreen mode the Jingles
   "Add to Pad" and "Schedule" dialogs are not visible; outside fullscreen both work normally, and On-Air works.
   Classified as a fullscreen modal / UI visibility issue only — NOT a jingle backend or playback issue; unrelated
   to Gate 3A. Non-blocking; fix in the later UI gate. (HYPOTHESIS, not proven: may explain the Gate 3A shadow
   review observation that a pad edit produced no server-side pad save.)
13. **EXISTING-USER WORKSPACE INVITE HAS NO ACCEPTANCE / CONSENT FLOW (security / product, recorded 2026-10-06 in
   Gate 3B-3).** `POST /api/admin/users` with an existing user's email adds that user to the caller's workspace
   immediately (`inviteExistingUserToWorkspace`), with no acceptance step. The account-takeover chains that used this
   are CLOSED in Gate 3B-3 (a workspace admin can no longer overwrite another user's global password, an invite never
   sets/changes an existing user's password, and global disable is platform SUPER_ADMIN only), but unsolicited
   membership itself remains. Needs a product decision (invite / accept flow); not redesigned in 3B-3.
14. **EXCESSIVE SCHEDULES POLLING (performance, recorded 2026-10-06 during Gate 3B-4a runtime review).** TEST HTTP logs
   show ~1,549 `GET /api/schedules` requests in ~9 minutes (19:38:44Z → 19:47:34Z; ~3 requests / second) — far above
   what a schedule check needs. NOT a Gate 3B-4a regression; not investigated or changed. Later audit should determine:
   exact caller(s); whether multiple renderers / components poll independently; the intended polling interval;
   duplicate timers / effects; the effect at 300-station scale; whether push / event-driven refresh can replace it.

15. **URL STARTUP LATENCY (performance — PARKED 2026-10-07 at the P0 lock).** Owner-observed ~15–76 s from command to
   audio for some yt-dlp URLs on the Lenovo (beta.12). Continuity is protected (outgoing audio continues; no watchdog
   restart; no force kill), so this is a PERFORMANCE item, not a playback-continuity P0. Own audit/gate; not part of
   the baseline-lock commit.
16. ~~**URL NATURAL EOF AUTO-ADVANCE**~~ — **FIXED 2026-10-07** (`8e8895a`, runtime accepted; see §7).
17. **EXTERNAL CONTROLLER OWNERSHIP RELEASE (playback, PARKED 2026-10-07).** Another controller switching MAIN to a
   source does not release the Lenovo renderer's session ownership. Own gate.
18. **yt-dlp `_MEI*` TEMP CLEANUP (desktop hygiene, PARKED 2026-10-07).** Leftover PyInstaller extraction folders from
   yt-dlp runs. Own gate.
19. **MAIN engine failure with mock status "playing" (watchdog residual, recorded 2026-10-07).** Recovery then relies
   on the 120 s startup hard max instead of the 12 s stall rule. Record only.

20. **WATCHDOG MANUAL-LAUNCH RACE (Protection, NON-P0, recorded 2026-10-07).** After an intentional stop followed by a
   manual launch, the watchdog may briefly issue a redundant launch because it still sees the old PID; single-instance
   protection currently absorbs it (no duplicate player observed). Own audit; do NOT fix now.

21. **PREMATURE LONG-URL EOF (playback, PARKED 2026-10-07).** Long (~2 h) YouTube URLs reached `MPV_ENDFILE reason=eof`
   at ~14 min (r7, r8). Since `8e8895a` the session advances instead of going silent, but the premature termination
   itself is UNEXPLAINED. Own audit / gate (evidence first).
22. **STARTUP SOURCE RESTORE / SETTINGS COHERENCE (playback, PARKED 2026-10-07).** VONO startup always resumes LOCAL even
   when URL / YouTube was the last active source; a renderer reload / navigation to Settings can start stale LOCAL while
   MAIN still reports URL. Desired: startup / reload restores the actual active source / session (not blindly LOCAL);
   no UI / audio source mismatch. Own audit / gate.

Carried over (still open):
- Jingle library/pads still use `branchId:"default"`; no link to `MediaAsset`; generated-but-unsaved MP3s
  are never cleaned up; `/api/jingles/audio/<id>` is unauthenticated (UUID-only).
- Desktop app has no local Preview engine yet (Preview unavailable there by design for now).
- Temporary `[VONO MetaSync]` `console.warn` diagnostics — still present in `lib/device-player-context.tsx`.
- `[VONO Shuffle Diag]` `console.log` — still present in `components/audio-player.tsx` (~4395).
- Git stash `pr52-xfade-diag-hold` (`stash@{0}`) — still present; diagnostic only.
- Long-outage / token-expiry endurance test — not yet run.
- ~~URL startup latency (~10–13 s on Lenovo)~~ — superseded by §9 item 15 (observed 15–76 s, 2026-10-07).
- Reconnect: CONTROL LOCAL title display blank — addressed in `9264bb3`; **NOT runtime-confirmed**.
- Offline cache edge: a TEST deploy during an outage may break lazily-loaded UI pieces until restart.
- Offline station cannot play hosted jingle MP3s (no local jingle cache yet).
- SECURITY TODO: a Railway token is stored in plaintext in `.claude/settings.local.json`
  (gitignored, not committed) — rotate the token and remove it, separately.
- Pre-existing desktop `tsconfig.typecheck.json` errors (not the packaging path) — known, untouched.

## 10. DO NOT REGRESS

*(added 2026-10-07, P0 URL continuity + ownership — renderer `d617314`)*
- URL session natural EOF → exactly one auto-advance to the next URL (no wrap at the last item, no duplicate load)
- while MAIN plays a URL session, LOCAL autonomous transitions (AUTOMIX / NEXT / PLAY_REQUEST / crossfade / load) are inert
- explicit URL → LOCAL switch, LOCAL-only AUTOMIX and manual LOCAL NEXT unchanged

*(added 2026-10-07, P0 playback hardening — beta.12)*
- URL trackIndex correct (no wrong first item); URL NEXT/PREV coherent; no LOCAL contamination of a URL session
- fresh MAIN attemptId per WS load; watchdog never restarts a slow-resolving URL (startup hard max 120 s); kill
  cancelled when health returns
- source-aware standby windows (LOCAL 12 s / stream 30 s / yt-dlp 90 s) — timeout keeps the current track
- stream crossfade only after real MPV progress (¬coreIdle, ¬pausedForCache); outgoing deck audible while buffering
- promoted deck volume + pause normalized; LOCAL→LOCAL crossfade fast path unchanged

- permanent designated MASTER (MAIN = MASTER, renderer = CONTROL; no failover, no steal)
- LOCAL playback
- URL playback
- LOCAL -> URL
- URL -> LOCAL
- NEXT
- PREV
- SEEK
- metadata handoff
- localSync idempotency / no flood
- natural EOF
- manual crossfade
- AUTOMIX natural crossfade
- reconnect while LOCAL plays
- no reconnect skips
- no reconnect stop/restart
- watchdog recovery
- restart WITH internet
- cold boot WITHOUT internet → LOCAL auto-resume (offline renderer cache)
- internet return after offline boot → no reload / stop / restart / jump
- heavy system load → no deck clear, no permanent stop (stall backstop never calls stop())
- **On-Air jingle from any CONTROL → designated MAIN: duck → play → resume; LOCAL queue/session intact**
- **Preview never emits PLAY_INTERRUPT (browser/mobile local; desktop Preview unavailable)**
- **jingle MP3s persisted on the TEST `/data` volume**
- renderer CONTROL + MAIN MASTER architecture
- no local file paths over WS/HTTP/server/DB/logs (PLAY_INTERRUPT rejects local paths)

## 11. LAST ACCEPTANCE

- **Date:** 2026-10-07 — **P0 PLAYBACK HARDENING** — Desktop 2.2.8-beta.12 (SHA256 `3becd1c8…9429`) + TEST renderer
  `3d6a70d` (deployment `a1028a7f`). **OWNER-ATTESTED** on the Lenovo (§7). Result: ACCEPTED; baseline locked
  (tags in §12). Previous acceptance below.

- **Date:** 2026-10-05
- **Build under test:** Desktop 2.2.8-beta.10 (TEST-pinned, SHA256 `0e292ec1…f9b0`) + TEST renderer `cd4c631`.
- **OWNER-ATTESTED:** §7 jingles list — Generate in TEST, MP3 persisted, On-Air from CONTROL reaches the
  designated Lenovo MASTER, music ducks, announcement plays, music resumes, LOCAL queue/session intact,
  Preview cannot broadcast.
- **CLAUDE-VERIFIED (TEST server):** one real generate → MP3 on `/data/jingles`, survives restart/redeploy.
- **Result:** JINGLES / ANNOUNCEMENTS — PILOT ACCEPTED (player phase acceptance remains in force).

## 12. ROLLBACK

| Layer | Reference |
|---|---|
| **Control Room F3a (2026-10-07)** | tag `pilot-baseline/2026-10-07-control-room-f3a-ca8312e` → `ca8312e81b92e6ac82e970f09d3007e1f8f87546`; app deployment `4d2b0f53`; DB backup `D:\SyncBiz_Backups\test-env\20261007T195345Z-control-room-f3a\` (or drop the additive F3a tables / columns) |
| **Renderer / playback baseline (2026-10-07, CURRENT)** | tag `pilot-baseline/2026-10-07-renderer-d617314` → `d61731471cc9a8a52965c417a0a3898495b721e8`; TEST deployment `3f258faf` (renderer only — Desktop installer unchanged, beta.12) |
| **Control Room F2a (2026-10-07)** | tag `pilot-baseline/2026-10-07-control-room-f2a-398cce7` → `398cce77662ad4d5fda79c7738556b6620a660f1`; app deployment `54f898f9`; DB backup `D:\SyncBiz_Backups\test-env\20261007T104212Z-control-room-f2a\` (or drop MemberScopeTarget + MemberScope) |
| **Control Room F1 (2026-10-07)** | tag `pilot-baseline/2026-10-07-control-room-f1-25d4c06` → `25d4c0685517f235df69fac3fb89c555807ef698`; app deployment `538902e8`; DB backup `D:\SyncBiz_Backups\test-env\20261007T094829Z-control-room-f1\` (or drop the additive F1 objects) |
| **CURRENT desktop baseline tag (2026-10-07)** | `pilot-baseline/2026-10-07-desktop-beta12-dc74457` → `dc744575e97279358e6794687ed37d408706677d` |
| **CURRENT renderer baseline tag (2026-10-07)** | `pilot-baseline/2026-10-07-renderer-3d6a70d` → `3d6a70de92e54e88ba00e2f7f14dc6589e5cf644`; TEST deployment `a1028a7f-98f2-4a5f-9a82-fb47f35f03f7` |
| **CURRENT accepted installer** | `D:\SyncBiz_Backups\pilot\2026-10-07-beta12-p0-accepted\SyncBiz-Player-Setup-2.2.8-beta.12-x64.exe`, SHA256 `3becd1c881c6c847f11c0c10f2f1549c7987be92bb1e83808b36cf8528e49429` |
| **Accepted renderer tag** (previous, jingles) | `pilot-baseline/2026-10-05-renderer-cd4c631` → `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| **Accepted desktop source-lineage tag** | `pilot-baseline/2026-10-05-desktop-beta10-cd4c631` → `cd4c631fc90570f062040def825f0c91bcff5bc3` |
| **Accepted installer artifact** | `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-accepted\SyncBiz-Player-Setup-2.2.8-beta.10-x64.exe`, SHA256 `0e292ec190f587dca920f4f0d00a50fe67cfbb934f21c8aaf377bc3c4b23f9b0` |
| Railway TEST deployment | `b591c130-4112-433a-a928-6f0f424a5dce` (may become non-redeployable once REMOVED — the tag is the fallback) |
| Older rollback (preserved) | player phase: tags `pilot-baseline/2026-10-05-renderer-2ebdbe4`, `pilot-baseline/2026-10-05-desktop-beta9-865ba81`; artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\` (SHA256 `72744069…6dc58`). Pre-offline: tags `…renderer-bfd3a49`, `…desktop-beta8-9264bb3`; artifact `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\` (SHA256 `349152a9…583ff`) |

All `pilot-baseline/*` tags are annotated and pushed to origin (owner-approved). Never use the
`desktop-v*` prefix (triggers the release workflow).

**WARNING:** desktop source tags do NOT reproduce beta.8/beta.9/beta.10 exactly by themselves — all used
temporary TEST-pin edits. Restore the Lenovo from the preserved installer binary, verified by hash.
Rolling the renderer back below `cd4c631` while beta.10 is installed is safe (MAIN PLAY_INTERRUPT is
additive); rolling the desktop back to beta.9 loses MAIN On-Air jingles.

## 13. HISTORY

### Player phase acceptance (2026-10-05) — superseded as "current" by the jingles acceptance above
- Renderer application baseline `2ebdbe4b9f2945e91987b2dfb5f61719103a9adf` (LOCAL startup-stall fix);
  docs-only head `17a1b849e7005f99e51269db5a0d42689ab8acc0`.
- Desktop `2.2.8-beta.9`, source lineage `865ba81e5cb83be8493ab7374194aa1d145ea633` + temporary TEST
  pins; SHA256 `72744069ad422c45130ddf530880f7e0fdc7b8b071dfd0fbde4693357ce6dc58`, 140,768,398 bytes,
  TEST-pinned, unsigned, not published; accepted backup `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-accepted\`
  (candidate copy `…-beta9-candidate\`).
- TEST renderer deployment `673fae24-3105-4360-8c31-88d83f61705f` (image
  `sha256:c2d16ad09077de4317b7f1c25a0c948e4c28209772d7b2f05c976d08827f7fff`); deployed
  `audio-player.tsx` + `desktop-freeze-self-heal.ts` file-hash identical to `2ebdbe4`.
- Owner-attested: §7 PLAYER PHASE items 1–9. Tags `pilot-baseline/2026-10-05-renderer-2ebdbe4`,
  `pilot-baseline/2026-10-05-desktop-beta9-865ba81`.

### Baseline 2026-10-05 (pre-offline-fix)
- Application/renderer baseline `bfd3a49a056b98a7d3daa33cd7aeb6e8ec29a5bb`; docs-only head
  `044219043c76dcfeae33350124b8d7faa4930c89` (constitution + first baseline).
- Desktop `2.2.8-beta.8`, source lineage `9264bb3331c1cd3953689f6fdd32f827332420a8` + temporary
  TEST pins; SHA256 `349152a9d9caa7c81634b2850fa967f2349b0e58eabde1df73e0cc66dfa583ff`,
  140,762,736 bytes, TEST-pinned, unsigned, not published; backup `D:\SyncBiz_Backups\pilot\2026-10-05-beta8\`.
- TEST renderer deployment `25b48cc0-03b1-48a9-a1d7-a099420eeabd` (image
  `sha256:d2a1e1ba5de3bc7ed9e0bcb61e6ef8c014ad0b3be03d0f4268af066f016c74cf`); deployed source
  verified file-hash identical to `bfd3a49` (629 source files + root config files; linkage not
  cryptographically proven).
- Owner-attested at that baseline: LOCAL, URL, LOCAL↔URL, metadata handoff, stale-session fix,
  localSync flood fix, SEEK, manual NEXT crossfade, natural AUTOMIX, MAIN WS auto-reconnect, no
  reconnect skips / false EOF / stop / restart, designated MASTER return, renderer CONTROL, URL
  control after reconnect, watchdog relaunch, reboot with internet.
- Open P0 at that time: **OFFLINE COLD BOOT** — later FIXED (§8).

### Offline cold boot fix — test candidate (2026-10-05)
- `865ba81` pushed to PR #52; beta.9 candidate built and preserved at
  `D:\SyncBiz_Backups\pilot\2026-10-05-beta9-candidate\` (NOT accepted at that time; rollback was beta.8).
- Phase 1 proofs (real Electron 34.5.8, TEST): session fetch carries auth context; same-origin
  `protocol.handle` interception keeps origin + localStorage. E2E offline-cache proof PASS.
- Lenovo runtime then found the separate stall/session-destruction P0 → fixed in `2ebdbe4`.

### Jingles P0 — test candidate (2026-10-06)
- Audit: Generate failed on TEST (missing `ELEVENLABS_API_KEY`); no app volume; MAIN dropped
  `PLAY_INTERRUPT`; desktop Preview was On-Air; schedules localStorage-only (parked).
- TEST config: key added by the owner; `/data` volume attached; one real generate verified.
- `cd4c631` pushed; beta.10 candidate preserved at `D:\SyncBiz_Backups\pilot\2026-10-05-beta10-jingles-candidate\`;
  then owner-accepted on the Lenovo (§7).
