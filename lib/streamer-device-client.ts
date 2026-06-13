/**
 * Client-side storage for paired branch streamer devices (GOtv / Android TV).
 * Token is stored in localStorage — never in URL query params.
 */

export const STREAMER_DEVICE_TOKEN_KEY = "syncbiz-streamer-device-token";
export const STREAMER_DEVICE_BRANCH_KEY = "syncbiz-streamer-device-branch";

export function readStreamerDeviceToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = localStorage.getItem(STREAMER_DEVICE_TOKEN_KEY);
    return value?.trim() ? value.trim() : null;
  } catch {
    return null;
  }
}

export function persistStreamerDeviceCredentials(token: string, branchId: string): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STREAMER_DEVICE_TOKEN_KEY, token.trim());
    localStorage.setItem(STREAMER_DEVICE_BRANCH_KEY, branchId.trim() || "default");
  } catch {
    /* ignore */
  }
}

export function clearStreamerDeviceCredentials(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STREAMER_DEVICE_TOKEN_KEY);
    localStorage.removeItem(STREAMER_DEVICE_BRANCH_KEY);
  } catch {
    /* ignore */
  }
}

export function readStreamerDeviceBranchId(): string {
  if (typeof window === "undefined") return "default";
  try {
    return localStorage.getItem(STREAMER_DEVICE_BRANCH_KEY)?.trim() || "default";
  } catch {
    return "default";
  }
}

export function hasStreamerDeviceToken(): boolean {
  return Boolean(readStreamerDeviceToken());
}
