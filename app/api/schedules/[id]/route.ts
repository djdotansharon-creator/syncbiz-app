import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { normalizeScheduleTimeLocal } from "@/lib/schedule-target-helpers";
import { validateScheduleTarget } from "@/lib/schedule-target-validator";
import type { Schedule, ScheduleTargetType } from "@/lib/types";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

/** Next.js may pass encoded ids; clients may send stray spaces — normalize before store lookup. */
function normalizeScheduleRouteId(raw: string | undefined): string {
  if (raw == null || raw === "") return "";
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return raw.trim();
  }
}

async function requireScheduleAccess(schedule: Schedule | null) {
  const user = await getCurrentUserFromCookies();
  if (!user) return { ok: false as const, status: 401 } as const;
  if (!schedule) return { ok: false as const, status: 404 } as const;
  const scope = resolveAccountScope(user.tenantId);
  const scheduleAccount = (schedule.accountId ?? "").trim();
  if (scheduleAccount !== scope) {
    console.error("[requireScheduleAccess] workspace mismatch — schedule.accountId:", scheduleAccount, "user scope:", scope, "scheduleId:", schedule.id);
    // Stale workspace ID (e.g. DB was reset): fall through and allow owner to manage their own schedules.
    // We still validate branch access below.
  }
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
  const { id: rawId } = await params;
  const id = normalizeScheduleRouteId(rawId);
  if (!id) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.ensureSchedulesLoaded();
  const schedule = await db.findScheduleById(id);
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
  const { id: rawId } = await params;
  const id = normalizeScheduleRouteId(rawId);
  if (!id) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.ensureSchedulesLoaded();
  const existing = await db.findScheduleById(id);
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
  if (data.startTimeLocal !== undefined) updates.startTimeLocal = normalizeScheduleTimeLocal(data.startTimeLocal);
  if (data.endTimeLocal !== undefined) {
    const er = data.endTimeLocal;
    updates.endTimeLocal =
      typeof er === "string" && er.trim().length > 0 ? normalizeScheduleTimeLocal(er) : "23:59";
  }
  if (data.enabled !== undefined) updates.enabled = data.enabled;
  if (data.priority !== undefined) updates.priority = data.priority;
  if (data.timezone !== undefined) updates.timezone = data.timezone;
  if (data.requestedStartPosition !== undefined) updates.requestedStartPosition = data.requestedStartPosition;
  if (data.requestedEndPosition !== undefined) updates.requestedEndPosition = data.requestedEndPosition;
  if (data.recurrence !== undefined) updates.recurrence = data.recurrence;
  if (data.oneOffDateLocal !== undefined) updates.oneOffDateLocal = data.oneOffDateLocal;

  const uid = await getUserIdFromSession();
  if (uid) updates.updatedBy = uid;

  const updated = await db.updateSchedule(id, updates);
  await db.persistSchedules();
  revalidatePath("/schedules");
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  const id = normalizeScheduleRouteId(rawId);
  if (!id) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.ensureSchedulesLoaded();
  const schedule = await db.findScheduleById(id);
  const access = await requireScheduleAccess(schedule);
  if (!access.ok) {
    return NextResponse.json(
      access.status === 401 ? { error: "Unauthorized" } : access.status === 403 ? { error: "Forbidden: no access to this branch" } : { error: "Schedule not found" },
      { status: access.status },
    );
  }
  const deleted = await db.deleteSchedule(id);
  if (!deleted) {
    return NextResponse.json({ error: "Schedule not found" }, { status: 404 });
  }
  await db.persistSchedules();
  revalidatePath("/schedules");
  return NextResponse.json({ ok: true });
}
