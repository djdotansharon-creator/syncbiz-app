import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

/**
 * PATCH — SUPER_ADMIN manual editorial rating only (`curationRating`, `curationNotes`).
 * Does not touch recommendation scoring or source popularity metrics.
 */
export async function PATCH(req: Request, ctx: RouteCtx) {
  const admin = await getSuperAdminOrNull();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { catalogItemId } = await ctx.params;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const body = raw as { curationRating?: unknown; curationNotes?: unknown };

  if (typeof body.curationRating !== "number" || !Number.isInteger(body.curationRating)) {
    return NextResponse.json({ error: "curationRating must be an integer 0–5" }, { status: 400 });
  }
  const rating = body.curationRating;
  if (rating < 0 || rating > 5) {
    return NextResponse.json({ error: "curationRating must be between 0 and 5" }, { status: 400 });
  }

  let curationNotes: string | null = null;
  if ("curationNotes" in body) {
    const n = body.curationNotes;
    if (n === null || n === undefined) {
      curationNotes = null;
    } else if (typeof n === "string") {
      const t = n.trim();
      curationNotes = t.length === 0 ? null : t;
    } else {
      return NextResponse.json({ error: "curationNotes must be a string or null" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "Expected curationNotes (string or null)" }, { status: 400 });
  }

  const exists = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  await prisma.catalogItem.update({
    where: { id: catalogItemId },
    data: {
      curationRating: rating,
      curationNotes,
    },
    select: { id: true, curationRating: true, curationNotes: true },
  });

  return NextResponse.json({ ok: true });
}
