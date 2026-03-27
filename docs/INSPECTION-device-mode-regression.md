# Device Mode Regression – Inspection Report

**Status:** Inspection only. No code changes made.

---

## 1. Current Mode Assignment Flow

### State sources

| State | Source | Updated when |
|-------|--------|--------------|
| `deviceMode` | `SET_DEVICE_MODE` only | Initial registration, manual SET_MASTER/SET_CONTROL, or demotion |
| `masterDeviceId` | `SET_DEVICE_MODE`, `DEVICE_LIST` | Same + when receiving DEVICE_LIST (late-start fix) |
| `hasExistingMaster` | `SET_DEVICE_MODE` (secondaryDesktop), `DEVICE_LIST` (when CONTROL) | When CONTROL and masterDeviceId present |
| `effectiveDeviceMode` | Derived | `status === "connected" ? deviceMode : "MASTER"` |

### Message roles

**REGISTER**
- Client sends role, deviceId, authToken, branchId, isMobile.
- Server assigns `mode` (MASTER or CONTROL) and sends REGISTERED + SET_DEVICE_MODE.

**SET_DEVICE_MODE**
- Sent to a device when its mode changes.
- Contains `mode`, optional `masterDeviceId` (when CONTROL), optional `secondaryDesktop`.
- `deviceMode` and `masterDeviceId` are set only here (plus masterDeviceId from DEVICE_LIST).

**DEVICE_LIST**
- Broadcast after register/disconnect/SET_MASTER/SET_CONTROL.
- Contains `devices`, `masterDeviceId`, `sessionCode`.
- Client (late-start fix): updates `masterDeviceId` always; updates `hasExistingMaster` when `deviceModeRef.current === "CONTROL"`.
- Client does **not** update `deviceMode` from DEVICE_LIST.

**hasExistingMaster**
- True when this device was assigned CONTROL because another MASTER already existed (`secondaryDesktop` in SET_DEVICE_MODE).
- Or when CONTROL receives DEVICE_LIST with a non-null `masterDeviceId`.
- Controls whether “Another MASTER active” is shown and whether the Settings switch shows “opened in CONTROL mode”.

**Master lease (server)**
- `masterByBranch` = Map<branchKey, deviceId> of primary MASTER.
- `masterDisconnectedAt` = when MASTER disconnected (for grace period).
- `getReservedMasterForBranch`: returns deviceId if MASTER is in grace.
- On register: if deviceId === reserved → MASTER; else if reserved → CONTROL + secondaryDesktop; else → MASTER.

### Client display

- **DeviceModeIndicator** and **DeviceModeSettingsSwitch** use `effectiveDeviceMode` = `status === "connected" ? deviceMode : "MASTER"`.
- When `status !== "connected"`, both show “MASTER” (standalone local playback).

---

## 2. Settings UI Visibility Flow

### Component

- **DeviceModeSettingsSwitch** (`components/device-mode-settings-switch.tsx`).
- Renders MASTER/CONTROL toggle and “Another MASTER active” when relevant.

### Condition

```ts
if (!ctx?.isBranchConnected) return null;
```

So the whole component returns `null` when `!isBranchConnected`, and the section shows no toggle.

### `isBranchConnected`

```ts
isBranchConnected = isActive && authLoaded && !!effectiveUserId && status === "connected";
```

All must be true:
- `isActive`: pathname !== "/mobile"
- `authLoaded`: after /api/auth/me
- `effectiveUserId`: non-empty from auth
- `status === "connected"`: from WebSocket

### When the switch is hidden

1. `status !== "connected"` (connecting, disconnected, error).
2. No user (not logged in or auth fails).
3. Token/WS fails so status never becomes "connected".

### Relation to recent changes

The late-start fix added DEVICE_LIST handling to update `masterDeviceId` and `hasExistingMaster`. It does **not** change `deviceMode` or `isBranchConnected`, so it should not directly hide the Settings switch.

---

## 3. Root Cause Analysis

### 3a. Why both laptop and main computer show MASTER

**Hypothesis A: Both are disconnected**

- When `status !== "connected"`, `effectiveDeviceMode` is `"MASTER"` (standalone).
- If both have connection issues (token, WS, etc.), both would show “MASTER”.

**Hypothesis B: Both actually get MASTER from the server**

- `deviceMode` is only set via `SET_DEVICE_MODE`.
- Both showing MASTER implies both received `mode: "MASTER"`.
- Possible causes: different users (different `branchKey`), race on registration, or server logic assigning MASTER to both.

**Hypothesis C: Display vs actual mode**

- Both could show “MASTER” badge while one is actually CONTROL, if the indicator shows `effectiveDeviceMode` and there’s a bug in how it’s derived or passed down.

### 3b. `deviceMode` not overwritten by DEVICE_LIST

- DEVICE_LIST handler updates `masterDeviceId` and `hasExistingMaster` only.
- It does **not** call `setDeviceMode`.
- So DEVICE_LIST does not change `deviceMode`.

### 3c. `hasExistingMaster` handling

- In DEVICE_LIST: `if (deviceModeRef.current === "CONTROL") setHasExistingMaster(!!(data.masterDeviceId ?? null))`.
- Only runs when already CONTROL.
- If a device never gets SET_DEVICE_MODE with `mode: "CONTROL"`, `hasExistingMaster` will not be set from DEVICE_LIST. That’s expected.
- `SET_DEVICE_MODE` sets `hasExistingMaster` from `secondaryDesktop`.

### 3d. Settings switch disappearing

- The switch requires `isBranchConnected === true`.
- Anything that makes `status !== "connected"` or breaks auth will hide it:
  - WS not connecting.
  - Token fetch failing.
  - Auth/me failing (no `effectiveUserId`).
- If both devices show MASTER badges, they are likely `status === "connected"` and the switch should render. The observation “switch no longer visible” then suggests either:
  1. On the affected tab/route, `isBranchConnected` is false (e.g. different route, auth, or token).
  2. A layout or provider boundary change leaves Settings without DevicePlayerProvider context.

---

## 4. Relevant Files

| File | Role |
|------|------|
| `lib/remote-control/ws-client.ts` | `deviceMode`, `hasExistingMaster`, `masterDeviceId`; handlers for SET_DEVICE_MODE, DEVICE_LIST |
| `lib/device-player-context.tsx` | `effectiveDeviceMode`, `isBranchConnected`, `useRemoteControlWs` consumer |
| `components/device-mode-settings-switch.tsx` | Settings MASTER/CONTROL toggle; gated by `isBranchConnected` |
| `components/device-mode-indicator.tsx` | Header badge; gated by `isBranchConnected` |
| `app/(app)/settings/page.tsx` | Settings page; renders DeviceModeSettingsSwitch |
| `app/(app)/providers.tsx` | DevicePlayerProvider wrapping |
| `app/(app)/layout.tsx` | App layout and providers |
| `server/index.ts` | Mode assignment, broadcastDeviceList, master lease |

---

## 5. Safest Fix Plan

### Goal

- Only one device is MASTER per branch.
- CONTROL devices remain CONTROL.
- Settings shows the MASTER/CONTROL choice when appropriate.
- No regression to late-start control attach.
- Minimal, low-risk changes; avoid broad refactors.

### Recommended steps

#### 5.1. Ensure Settings switch is not over-gated (if needed)

If the problem is that the switch is hidden while the user is connected:

- Option A: Show the switch when `status === "connected"` even if `isBranchConnected` is false for other reasons, **or**
- Option B: Add a fallback that shows a “Connect to see mode options” message when `!isBranchConnected`, so the section is visible but the toggle is clearly disabled.

Choose based on product intent: either require full connection or improve UX when not connected.

#### 5.2. Clarify “MASTER” when disconnected

- When `status !== "connected"`, `effectiveDeviceMode` is forced to "MASTER".
- Both devices can then show “MASTER” (standalone) even though neither is branch MASTER.
- Consider showing a distinct label (e.g. “Standalone” or “Local”) when disconnected instead of “MASTER” to avoid confusion.

#### 5.3. Keep DEVICE_LIST behavior as-is

- Current DEVICE_LIST handling (masterDeviceId, hasExistingMaster) is needed for late-start control.
- Do not add logic that infers or overwrites `deviceMode` from DEVICE_LIST; it must stay authoritative from SET_DEVICE_MODE only.

#### 5.4. Server check (if both devices truly get MASTER)

- If both same-user devices receive `SET_DEVICE_MODE` with `mode: "MASTER"`, inspect:
  - `getReservedMasterForBranch` and registration logic for races or incorrect branch keys.
  - `broadcastDeviceList` ordering vs `SET_DEVICE_MODE` to ensure demotion is sent before updated DEVICE_LIST.
- Add targeted logging around registration and mode assignment to verify only one MASTER per branch.

### Files likely to change

| File | Change |
|------|--------|
| `components/device-mode-indicator.tsx` | Optionally show “Standalone” when disconnected instead of “MASTER” |
| `components/device-mode-settings-switch.tsx` | Optionally relax or refine `isBranchConnected` gate; add fallback message |
| `lib/device-player-context.tsx` | Possibly add a “standalone”/“disconnected” mode for display; no change to DEVICE_LIST behavior |

### Do not change

- `lib/remote-control/ws-client.ts` DEVICE_LIST handler (keep late-start fix).
- Server protocol or message formats.
- Broad refactor of mode or layout logic.
