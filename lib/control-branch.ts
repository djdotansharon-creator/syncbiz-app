/**
 * BROWSER CONTROL TARGET (owner 2026-10-13, presentation) — which branch a manager's BROWSER player controls.
 * Chosen in Control Room → Branch → "Control this branch's player"; stored in this browser only (localStorage).
 * lib/station-branch.ts uses it for the browser's sockets → the browser joins THAT branch room as CONTROL (the server
 * forces CONTROL for anything that is not the branch's designated station — MASTER logic is untouched).
 * The VONO desktop app NEVER reads this (its branch is MAIN's config). No choice → the legacy "default" branch, shown
 * openly in the player header ("Controlling: default branch") — never silent for a manager.
 */

export const CONTROL_BRANCH_KEY = "vono-control-branch";

export type ControlBranch = { branchId: string; label: string };

export function getControlBranch(): ControlBranch | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONTROL_BRANCH_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ControlBranch>;
    const branchId = typeof v.branchId === "string" ? v.branchId.trim() : "";
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(branchId)) return null;
    return { branchId, label: typeof v.label === "string" ? v.label.slice(0, 120) : branchId };
  } catch {
    return null;
  }
}

export function setControlBranch(sel: ControlBranch): void {
  try { window.localStorage.setItem(CONTROL_BRANCH_KEY, JSON.stringify(sel)); } catch { /* ignore */ }
}

export function clearControlBranch(): void {
  try { window.localStorage.removeItem(CONTROL_BRANCH_KEY); } catch { /* ignore */ }
}
