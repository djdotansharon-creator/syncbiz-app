import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { validateScheduleTarget } from "@/lib/schedule-target-validator";
import type { Schedule, ScheduleRecurrence, ScheduleTargetType } from "@/lib/types";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

export async function GET() {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!user.tenantId?.trim()) {
    return NextResponse.json({ error: "Tenant context missing" }, { status: 400 });
  }
  const all = db.getSchedules(resolveAccountScope(user.tenantId));
  const filtered = [];
  for (const s of all) {
    const branchId = (s.branchId ?? "default").trim() || "default";
    if (await hasBranchAccess(user.id, branchId)) {
      filtered.push(s);
    }
  }
  return NextResponse.json(filtered);
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = (await req.json()) as Partial<Schedule> & { sourceId?: string };

  const branchId = (data.branchId ?? "default").trim() || "default";
  const targetType: ScheduleTargetType = (data.targetType as ScheduleTargetType) ?? "SOURCE";
  const targetId = (data.targetId ?? data.sourceId ?? "").trim();
  const recurrence: ScheduleRecurrence = data.recurrence === "one_off" ? "one_off" : "weekly";
  const oneOffDateLocal =
    typeof data.oneOffDateLocal === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.oneOffDateLocal.trim())
      ? data.oneOffDateLocal.trim()
      : undefined;

  if (!branchId || !data.startTimeLocal) {
    return NextResponse.json(
      { error: "branchId and startTimeLocal are required" },
      { status: 400 },
    );
  }

  let daysOfWeek = Array.isArray(data.daysOfWeek) ? data.daysOfWeek : [];
  if (recurrence === "one_off") {
    if (!oneOffDateLocal) {
      return NextResponse.json(
        { error: "oneOffDateLocal (YYYY-MM-DD) is required for one-off schedules" },
        { status: 400 },
      );
    }
    daysOfWeek = [];
  } else if (daysOfWeek.length === 0) {
    return NextResponse.json(
      { error: "daysOfWeek is required for weekly schedules" },
      { status: 400 },
    );
  }

  if (targetType === "SOURCE" && !targetId && !data.sourceId) {
    return NextResponse.json(
      { error: "targetId or sourceId is required for SOURCE schedules" },
      { status: 400 },
    );
  }

  if (targetType !== "SOURCE" && !targetId) {
    return NextResponse.json(
      { error: "targetId is required" },
      { status: 400 },
    );
  }

  if (!(await hasBranchAccess(user.id, branchId))) {
    return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
  }

  const validation = await validateScheduleTarget(branchId, targetType, targetId || (data.sourceId ?? ""));
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const endRaw = data.endTimeLocal;
  const endTimeLocal =
    typeof endRaw === "string" && endRaw.trim().length > 0 ? endRaw : "23:59";
  const uid = await getUserIdFromSession();

  const schedule = db.addSchedule({
    name: data.name,
    branchId,
    targetType,
    targetId: targetId || data.sourceId!,
    sourceId: targetType === "SOURCE" ? (targetId || data.sourceId!) : undefined,
    deviceId: data.deviceId,
    recurrence,
    oneOffDateLocal: recurrence === "one_off" ? oneOffDateLocal : undefined,
    daysOfWeek,
    startTimeLocal: data.startTimeLocal!,
    endTimeLocal,
    enabled: data.enabled ?? true,
    priority: data.priority ?? 1,
    timezone: data.timezone,
    requestedStartPosition: data.requestedStartPosition,
    requestedEndPosition: data.requestedEndPosition,
    createdBy: uid ?? undefined,
    accountId: resolveAccountScope(user.tenantId),
  });

  return NextResponse.json(schedule, { status: 201 });
}

