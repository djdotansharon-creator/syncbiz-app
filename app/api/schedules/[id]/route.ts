import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { validateScheduleTarget } from "@/lib/schedule-target-validator";
import type { Schedule, ScheduleTargetType } from "@/lib/types";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

async function requireScheduleAccess(schedule: Schedule | null) {
  const user = await getCurrentUserFromCookies();
  if (!user) return { ok: false as const, status: 401 } as const;
  if (!schedule) return { ok: false as const, status: 404 } as const;
  const branchId = (schedule.branchId ?? "default").trim() || "default";
  if (!(await hasBranchAccess(user.id, branchId))) {
    return { ok: false as const, status: 403 } as const;
  }
  return { ok: true as const, user, schedule } as const;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const schedule = db.getSchedule(id, resolveAccountScope(user.tenantId));
  const access = await requireScheduleAccess(schedule);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Schedule not found" },
      { status: access.status },
    );
  }
  return NextResponse.json(access.schedule!);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const existing = db.getSchedule(id, resolveAccountScope(user.tenantId));
  const access = await requireScheduleAccess(existing);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Schedule not found" },
      { status: access.status },
    );
  }

  const data = (await req.json()) as Partial<Schedule> & { sourceId?: string };

  if (data.branchId !== undefined) {
    const branchId = (data.branchId ?? "default").trim() || "default";
    if (!(await hasBranchAccess(access.user!.id, branchId))) {
      return NextResponse.json({ error: "Forbidden: no access to target branch" }, { status: 403 });
    }
  }

  const targetType = (data.targetType ?? existing!.targetType) as ScheduleTargetType;
  const targetId = (data.targetId ?? data.sourceId ?? existing!.targetId ?? "").trim();

  if (data.targetType !== undefined || data.targetId !== undefined || data.sourceId !== undefined) {
    const branchId = (data.branchId ?? existing!.branchId ?? "default").trim() || "default";
    const validation = await validateScheduleTarget(branchId, targetType, targetId || existing!.targetId);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }
  }

  const updates: Partial<Schedule> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.branchId !== undefined) updates.branchId = data.branchId;
  if (data.targetType !== undefined) updates.targetType = data.targetType;
  if (data.targetId !== undefined) updates.targetId = data.targetId;
  if (data.sourceId !== undefined) updates.sourceId = data.sourceId;
  if (data.deviceId !== undefined) updates.deviceId = data.deviceId;
  if (data.daysOfWeek !== undefined) updates.daysOfWeek = data.daysOfWeek;
  if (data.startTimeLocal !== undefined) updates.startTimeLocal = data.startTimeLocal;
  if (data.endTimeLocal !== undefined) updates.endTimeLocal = data.endTimeLocal;
  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.timezone !== undefined) updates.timezone = data.timezone;
  if (data.requestedStartPosition !== undefined) updates.requestedStartPosition = data.requestedStartPosition;
  if (data.requestedEndPosition !== undefined) updates.requestedEndPosition = data.requestedEndPosition;

  const uid = await getUserIdFromSession();
  if (uid) updates.updatedBy = uid;

  const updated = db.updateSchedule(id, updates);
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const schedule = db.getSchedule(id, resolveAccountScope(user.tenantId));
  const access = await requireScheduleAccess(schedule);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Schedule not found" },
      { status: access.status },
    );
  }
  const deleted = db.deleteSchedule(id);
  if (!deleted) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
