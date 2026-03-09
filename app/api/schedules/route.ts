import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import type { Schedule } from "@/lib/types";

export async function GET() {
  return NextResponse.json(db.getSchedules());
}

export async function POST(req: NextRequest) {
  const data = (await req.json()) as Partial<Schedule>;

  if (
    !data.name ||
    !data.branchId ||
    !data.sourceId ||
    !data.daysOfWeek ||
    !data.startTimeLocal
  ) {
    return NextResponse.json(
      {
        error:
          "name, branchId, sourceId, daysOfWeek, and startTimeLocal are required for creating a schedule",
      },
      { status: 400 },
    );
  }

  const endTimeLocal = data.endTimeLocal ?? "23:59";

  const schedule = db.addSchedule({
    name: data.name,
    branchId: data.branchId,
    deviceId: data.deviceId,
    sourceId: data.sourceId,
    daysOfWeek: data.daysOfWeek,
    startTimeLocal: data.startTimeLocal,
    endTimeLocal,
    enabled: data.enabled ?? true,
    priority: data.priority ?? 1,
    requestedStartPosition: data.requestedStartPosition,
    requestedEndPosition: data.requestedEndPosition,
  });

  return NextResponse.json(schedule, { status: 201 });
}

