import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { isValidManualEnergyRating } from "@/lib/catalog-manual-energy-bpm";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

/**
 * PATCH — SUPER_ADMIN manual energy rating (1–10) or null to clear.
 * Does not affect DJ Creator, smart-search, or playback.
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

  const body = raw as { manualEnergyRating?: unknown };
  if (!("manualEnergyRating" in body)) {
    return NextResponse.json({ error: "Expected manualEnergyRating (integer 1–10 or null)" }, { status: 400 });
  }

  if (!isValidManualEnergyRating(body.manualEnergyRating)) {
    return NextResponse.json({ error: "manualEnergyRating must be null or an integer from 1 to 10" }, { status: 400 });
  }

  const exists = await prisma.catalogItem.findUnique({
    where: { id: catalogItemId },
    select: { id: true },
  });
  if (!exists) {
    return NextResponse.json({ error: "Catalog item not found" }, { status: 404 });
  }

  const manualEnergyRating = body.manualEnergyRating === null ? null : body.manualEnergyRating;

  const updated = await prisma.catalogItem.update({
    where: { id: catalogItemId },
    data: { manualEnergyRating },
    select: { id: true, manualEnergyRating: true },
  });

  return NextResponse.json({ ok: true, manualEnergyRating: updated.manualEnergyRating });
}
