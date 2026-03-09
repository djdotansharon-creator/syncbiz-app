type PlayerRuntimeStatus = "playing" | "paused" | "stopped";

export type DevicePlayerState = {
  deviceId: string;
  target: string;
  status: PlayerRuntimeStatus;
  currentTime: number;
  volume: number;
  updatedAt: string;
};

const byDevice = new Map<string, DevicePlayerState>();

export function updateDevicePlayerState(
  deviceId: string,
  patch: Partial<DevicePlayerState> & { status: PlayerRuntimeStatus },
): DevicePlayerState {
  const current = byDevice.get(deviceId);
  const next: DevicePlayerState = {
    deviceId,
    target: patch.target ?? current?.target ?? "",
    status: patch.status,
    currentTime: patch.currentTime ?? current?.currentTime ?? 0,
    volume: patch.volume ?? current?.volume ?? 80,
    updatedAt: new Date().toISOString(),
  };
  byDevice.set(deviceId, next);
  return next;
}

export function getDevicePlayerState(deviceId: string): DevicePlayerState | null {
  return byDevice.get(deviceId) ?? null;
}

export function getAllDevicePlayerStates(): DevicePlayerState[] {
  return Array.from(byDevice.values());
}
