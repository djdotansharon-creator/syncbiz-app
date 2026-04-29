import { NextResponse } from "next/server";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type RouteCtx = { params: Promise<{ catalogItemId: string }> };

/**
 * PATCH — SUPER_ADMIN manual curated catalog title only (never called from source metadata sync).
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

  const titleRaw = (raw as { title?: unknown }).title;
  if (typeof titleRaw !== "string") {
    return NextResponse.json({ error: "Expected { title: string }" }, { status: 400 });
  }

  const title = titleRaw.trim();
  if (title.length === 0) {
    return NextResponse.json({ error: "Title must be a non-empty string" }, { status: 400 });
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
    data: { title },
    select: { id: true, title: true },
  });

  return NextResponse.json({ ok: true });
}
