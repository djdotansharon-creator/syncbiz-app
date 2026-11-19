/**
 * Which tab of the Jingles console to open on (owner 2026-10-18: "All jingles" shows the existing jingles at once when there are
 * some, and goes straight to Create when there are none). The queue pane sets it before opening the centre module; the console
 * takes it when it mounts — or, if it is already open, reacts to the event.
 */
export type JinglesOpenTab = "create" | "library" | "schedule";
export const JINGLES_OPEN_TAB_EVENT = "syncbiz:jingles-open-tab";

let pending: JinglesOpenTab | null = null;

export function setJinglesOpenTab(tab: JinglesOpenTab): void {
  pending = tab;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(JINGLES_OPEN_TAB_EVENT, { detail: tab }));
}

export function takeJinglesOpenTab(): JinglesOpenTab | null {
  const t = pending;
  pending = null;
  return t;
}

/**
 * Open a SCHEDULED jingle's own settings (owner 2026-11-19: the Schedules screen's jingle marker says "Edit", and it lands on that jingle's time / days screen).
 * Set before opening the console (it takes it when it mounts) — or, if it is already open, it reacts to the event.
 */
export const JINGLES_OPEN_EDIT_EVENT = "syncbiz:jingles-open-edit";

let pendingEdit: string | null = null;

export function setJinglesOpenEdit(scheduleItemId: string): void {
  pendingEdit = scheduleItemId;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(JINGLES_OPEN_EDIT_EVENT, { detail: scheduleItemId }));
}

export function takeJinglesOpenEdit(): string | null {
  const id = pendingEdit;
  pendingEdit = null;
  return id;
}
