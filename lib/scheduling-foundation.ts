export type DaypartSlotId = "morning" | "afternoon" | "evening" | "night" | `custom:${string}`;

export type PlaylistScheduleAssignment = {
  slotId: DaypartSlotId;
  playlistKey: string;
  updatedAt: number;
};

export type ScheduleWindow = {
  slotId: DaypartSlotId;
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  enabled: boolean;
};

export type SchedulingFoundationState = {
  assignments: PlaylistScheduleAssignment[];
  windows: ScheduleWindow[];
  updatedAt: number;
};

export const SCHEDULING_FOUNDATION_STORAGE_KEY = "syncbiz-scheduling-foundation-v1";

export function loadSchedulingFoundationState(): SchedulingFoundationState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SCHEDULING_FOUNDATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SchedulingFoundationState;
    if (!parsed || !Array.isArray(parsed.assignments) || !Array.isArray(parsed.windows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveSchedulingFoundationState(state: SchedulingFoundationState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(SCHEDULING_FOUNDATION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}
