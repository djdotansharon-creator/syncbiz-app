/**
 * The branch's SCHEDULE switch (owner 2026-11-16): "the schedule of THIS player is on / off" — stored with the branch (Branch.scheduleEnabled), not in a browser. Whoever can edit the branch's
 * schedules can flip it, from anywhere; the branch's player reads it with its schedules and obeys. It never touches another branch.
 *
 * A schedule's branch key is a real branch id, or the legacy key "default" — which is the workspace's canonical branch when it has one (same-workspace alias, as everywhere in Gate 2B).
 * A key that is not a real branch of this business (an orphan / unmapped legacy key) has no row: it keeps running (fail-open, as before) and cannot be switched off.
 */
import { prisma } from "@/lib/prisma";
import { getCanonicalLegacyBranchId } from "@/lib/branch-resolver";

export type ScheduleSwitchState = { enabled: boolean; switchable: boolean; branchId: string | null };

/** the id of the Branch row a schedule branch key stands for in this business, or null */
export async function resolveScheduleBranchId(workspaceId: string, branchKey: string): Promise<string | null> {
  const key = (branchKey ?? "").trim() || "default";
  let id = key;
  if (key === "default") {
    const canonical = await getCanonicalLegacyBranchId(workspaceId);
    if (canonical) id = canonical;
  }
  try {
    const row = await prisma.branch.findFirst({ where: { id, workspaceId }, select: { id: true } });
    return row?.id ?? null;
  } catch {
    return null;
  }
}

export async function getScheduleSwitch(workspaceId: string, branchKey: string): Promise<ScheduleSwitchState> {
  const id = await resolveScheduleBranchId(workspaceId, branchKey);
  if (!id) return { enabled: true, switchable: false, branchId: null };
  try {
    const row = await prisma.branch.findFirst({ where: { id, workspaceId }, select: { scheduleEnabled: true } });
    return { enabled: row?.scheduleEnabled !== false, switchable: true, branchId: id };
  } catch {
    return { enabled: true, switchable: false, branchId: id }; // the flag cannot be read: the schedule keeps running (never silent because of a read error)
  }
}

/** null = the key is not a real branch of this business (nothing to switch) */
export async function setScheduleSwitch(workspaceId: string, branchKey: string, enabled: boolean): Promise<ScheduleSwitchState | null> {
  const id = await resolveScheduleBranchId(workspaceId, branchKey);
  if (!id) return null;
  await prisma.branch.update({ where: { id }, data: { scheduleEnabled: enabled } });
  return { enabled, switchable: true, branchId: id };
}
