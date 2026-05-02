import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { catalogDiscoveryActiveWhere } from "@/lib/catalog-discovery-scope";

const LIMIT = 12;

export async function GET(req: NextRequest) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ items: [] });

  const genre = req.nextUrl.searchParams.get("genre")?.trim() ?? "";

  // Match any word in the query against the title (case-insensitive)
  const words = q.split(/\s+/).filter((w) => w.length > 1);

  const items = await prisma.catalogItem.findMany({
    where: {
      AND: [
        catalogDiscoveryActiveWhere,
        { OR: words.map((w) => ({ title: { contains: w, mode: "insensitive" as const } })) },
        ...(genre ? [{ genres: { has: genre } }] : []),
      ],
    },
    select: { id: true, url: true, title: true, thumbnail: true, genres: true },
    orderBy: [{ analytics: { playCount: "desc" } }, { createdAt: "desc" }],
    take: LIMIT,
  });

  return NextResponse.json({ items });
}
