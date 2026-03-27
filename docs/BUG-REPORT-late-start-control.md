# Late-Start Control Bug – Inspection Report

**Status:** Inspection only – no code changes made.

**Scenario:** CONTROL device/page is already open. MASTER device is offline/closed. Later, MASTER opens and becomes available. CONTROL still does not affect MASTER automatically. Refresh is required.

---

## 1. Current Behavior Flow

### When CONTROL connects while no MASTER exists

| Step | Component | Action |
|------|-----------|--------|
| 1 | CONTROL device | Registers via `REGISTER` (role: device, deviceId, branchId) |
| 2 | Server | No reserved master, no existing master → first desktop becomes **MASTER** |
| 3 | Server | Sends `SET_DEVICE_MODE` with `mode: "MASTER"` to the connecting device |
| 4 | Result | The “CONTROL” device actually becomes MASTER if it connects first |

**Alternative (user demotes to CONTROL):** If user explicitly clicks “Set Control” on the tablet:

| Step | Action |
|------|--------|
| 1 | Device sends `SET_CONTROL` |
| 2 | Server clears `masterByBranch` for that branch |
| 3 | Server sends `SET_DEVICE_MODE` with `mode: "CONTROL"` to that device (no `masterDeviceId`) |
| 4 | `broadcastDeviceList()` runs → `masterDeviceId` is null |
| 5 | CONTROL device: `masterDeviceId` stays null |

### State stored on controller (device in CONTROL mode)

| State | Source | Updated when |
|-------|--------|--------------|
| `masterDeviceId` | `SET_DEVICE_MODE` only | Initial registration or manual SET_MASTER/SET_CONTROL |
| `deviceMode` | `SET_DEVICE_MODE` | Same |
| `sessionCode` | `DEVICE_LIST` or `REGISTERED` | Any `DEVICE_LIST` |

**Important:** For role `"device"`, `masterDeviceId` is **not** updated from `DEVICE_LIST`.

### When MASTER later connects

| Step | Component | Action |
|------|-----------|--------|
| 1 | MASTER device | Registers via `REGISTER` |
| 2 | Server | Assigns mode `MASTER`, sets `masterByBranch` |
| 3 | Server | Calls `broadcastDeviceList()` |
| 4 | Server | Sends `DEVICE_LIST` to all devices and controllers (includes new `masterDeviceId`) |
| 5 | CONTROL device | Receives `DEVICE_LIST` |
| 6 | CONTROL device handler | Only updates `sessionCode`; **ignores `masterDeviceId`** |
| 7 | Result | `masterDeviceId` on CONTROL stays null or stale; commands cannot be routed |

### Events sent

| Event | When | Contains |
|-------|------|----------|
| `DEVICE_LIST` | On any device register, on disconnect, on SET_MASTER/SET_CONTROL | `devices`, `masterDeviceId`, `sessionCode` |
| `SET_DEVICE_MODE` | Only to the device that just registered or that changed mode | `mode`, `masterDeviceId` (when CONTROL) |
| `STATE_UPDATE` | When MASTER sends playback state | `deviceId`, `state` |

### What should cause CONTROL to attach to MASTER

The CONTROL device should update `masterDeviceId` when it receives `DEVICE_LIST` with a valid `masterDeviceId`, so it can route commands to the current MASTER.

---

## 2. Root Cause

### Does controller receive updated DEVICE_LIST but fail to rebind?

**Yes.** The device in CONTROL mode receives `DEVICE_LIST` when MASTER connects (and when MASTER disconnects). The handler for `DEVICE_LIST` in `useRemoteControlWs` (role `"device"`) does **not** update `masterDeviceId`:

```javascript
} else if (data.type === "DEVICE_LIST" && "sessionCode" in data) {
  if (data.sessionCode) setSessionCode(data.sessionCode);
}
```

`masterDeviceId` is only updated from `SET_DEVICE_MODE`, which is sent only:

- To the device that **just registered**
- To devices that are **demoted** when another device does `SET_MASTER`

When MASTER connects **after** CONTROL, no `SET_DEVICE_MODE` is sent to the existing CONTROL device. Only `DEVICE_LIST` is broadcast, and its `masterDeviceId` is ignored.

### Is `masterDeviceId` not recomputed?

Yes. The device client keeps the old `masterDeviceId` (or null) and never applies the new value from `DEVICE_LIST`.

### Is there missing effect logic when a MASTER appears after initial load?

Yes. The device client has no handler for “MASTER appeared” other than `SET_DEVICE_MODE`. The natural signal for that is `DEVICE_LIST` with a new `masterDeviceId`, but that is not processed.

### Is there stale state on the controller?

Yes. `masterDeviceId` remains null or points to a disconnected device when MASTER comes online later.

---

## 3. Relevant Files

| Area | File | Responsibility |
|------|------|----------------|
| Device WS client | `lib/remote-control/ws-client.ts` | `useRemoteControlWs` (role `"device"`) – handles `DEVICE_LIST` but does not update `masterDeviceId` |
| Controller WS client | `lib/remote-control/ws-client.ts` | `useRemoteController` (role `"controller"`) – **does** update `masterDeviceId` from `DEVICE_LIST` ✓ |
| Device context | `lib/device-player-context.tsx` | Uses `masterDeviceId` from WS client for `sendCommandToMaster` |
| Server broadcast | `server/index.ts` | `broadcastDeviceList()` sends `DEVICE_LIST` to devices and controllers |
| Server registration | `server/index.ts` | Device register flow, `SET_DEVICE_MODE` only to registering/demoted device |

### Flow summary

```
MASTER connects
  → server: broadcastDeviceList()
  → DEVICE_LIST { masterDeviceId: "<new-master-id>" }
  → CONTROL device: receives message
  → handler: updates sessionCode only, ignores masterDeviceId
  → masterDeviceId stays null/stale
  → sendCommandToMaster(masterDeviceId, ...) fails or targets wrong device
```

---

## 4. Safest Fix Plan

### Minimal change

In `useRemoteControlWs` (role `"device"`), when handling `DEVICE_LIST`, also update `masterDeviceId` (and optionally `hasExistingMaster`):

```javascript
} else if (data.type === "DEVICE_LIST") {
  if (data.sessionCode) setSessionCode(data.sessionCode);
  if ("masterDeviceId" in data) {
    setMasterDeviceId(data.masterDeviceId ?? null);
  }
  // hasExistingMaster: true when we're CONTROL and there is a MASTER
  if (deviceModeRef.current === "CONTROL") {
    setHasExistingMaster(!!(data.masterDeviceId ?? null));
  }
}
```

### Rationale

- Matches what `useRemoteController` (role `"controller"`) already does.
- No server changes.
- No protocol changes.
- Only adds handling of existing `DEVICE_LIST` fields on the device client.
- When CONTROL receives `DEVICE_LIST` with a new `masterDeviceId`, it rebinds immediately.

### Edge cases

- **CONTROL is MASTER:** If the device is MASTER, `masterDeviceId` from `DEVICE_LIST` would be its own id. It does not use `sendCommandToMaster` in that mode, so this is harmless.
- **DEVICE_LIST with null masterDeviceId:** Sets `masterDeviceId` to null, which is correct when MASTER disconnects.
- **Race with SET_DEVICE_MODE:** Both can update `masterDeviceId`; the latest value wins, which is desired.

---

## 5. Files Likely to Change

| File | Change |
|------|--------|
| `lib/remote-control/ws-client.ts` | In `useRemoteControlWs` (role `"device"`), extend `DEVICE_LIST` handler to set `masterDeviceId` (and optionally `hasExistingMaster`) |

**No changes needed:**

- Server
- `lib/device-player-context.tsx`
- `useRemoteController` (already correct)
