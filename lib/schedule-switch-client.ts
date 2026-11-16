/**
 * The branch's schedule switch, browser side (owner 2026-11-16: "the schedule of THIS player is on / off"). The value lives with the branch on the server (Branch.scheduleEnabled); the player
 * reads it with its schedules (`X-Schedule-Enabled`), the studio reads / writes it through /api/schedules/switch. This window's own player is nudged at once through an event.
 */
export const SCHEDULE_SWITCH_EVENT = "syncbiz-schedule-switch";

export type ScheduleSwitch = { enabled: boolean; switchable: boolean };

/** the branch's current switch, or null when it cannot be read (offline / no access) */
export async function fetchScheduleSwitch(branchKey: string): Promise<ScheduleSwitch | null> {
  try {
    const res = await fetch(`/api/schedules/switch?branchId=${encodeURIComponent(branchKey)}`, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<ScheduleSwitch>;
    return { enabled: j.enabled !== false, switchable: j.switchable === true };
  } catch {
    return null;
  }
}

/** save the branch's switch; throws with the server's words when it could not be saved */
export async function saveScheduleSwitch(branchKey: string, enabled: boolean): Promise<ScheduleSwitch> {
  const res = await fetch("/api/schedules/switch", {
    method: "PUT",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ branchId: branchKey, enabled }),
  });
  const j = (await res.json().catch(() => ({}))) as Partial<ScheduleSwitch> & { error?: string };
  if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SCHEDULE_SWITCH_EVENT)); // this window's own player looks at once
  return { enabled: j.enabled !== false, switchable: j.switchable === true };
}
