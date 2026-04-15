import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import type { Announcement } from "@/lib/types";

export async function GET() {
  return NextResponse.json(await db.getAnnouncements());
}

export async function POST(req: NextRequest) {
  const data = (await req.json()) as Partial<Announcement>;

  if (!data.title || !data.message || !data.branchId || !data.windowStart || !data.windowEnd) {
    return NextResponse.json(
      {
        error:
          "title, message, branchId, windowStart, and windowEnd are required for creating an announcement",
      },
      { status: 400 },
    );
  }

  const announcement = await db.addAnnouncement({
    title: data.title,
    message: data.message,
    branchId: data.branchId,
    scheduleId: data.scheduleId,
    status: data.status ?? "draft",
    priority: data.priority ?? "normal",
    ttsEnabled: data.ttsEnabled ?? false,
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
  });

  return NextResponse.json(announcement, { status: 201 });
}

