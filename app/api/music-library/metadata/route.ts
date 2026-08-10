import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import {
  listMusicLibraryMetadata, saveEnrichment, refreshFromBank,
  type MetadataFilters, type EnrichmentPatch, type OriginalRead,
} from "@/lib/universal/music-library-metadata";
import type { EnrichmentScope } from "@prisma/client";

export const dynamic = "force-dynamic";

const DEFAULT_DEVICE = "dev-local-bank";

/** Hard guard: this screen manages LOCAL enrichment only — it must NEVER touch production. */
function assertLocalDb() {
  const url = process.env.DATABASE_URL ?? "";
  const host = (url.match(/@([^:/]+)/) ?? [])[1] ?? "";
  if (!(host === "localhost" || host === "127.0.0.1"))
    throw new Error(`music-library API refuses non-local DB (host=${host})`);
}

async function resolveSourceId(device: string): Promise<string | null> {
  const s = await prisma.localLibrarySource.findUnique({ where: { deviceId: device } });
  return s?.id ?? null;
}

export async function GET(req: NextRequest) {
  try {
    // ADMIN-only internal management surface — regular users get 403.
    if (!(await getSuperAdminOrNull())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    assertLocalDb();
    const q = req.nextUrl.searchParams;
    const device = q.get("device") ?? DEFAULT_DEVICE;
    const sourceId = await resolveSourceId(device);
    if (!sourceId) return NextResponse.json({ rows: [], customFields: [], typos: [], total: 0, source: null });

    const bool = (k: string) => (q.has(k) ? q.get(k) === "true" : undefined);
    const num = (k: string) => (q.has(k) ? Number(q.get(k)) : undefined);
    const filters: MetadataFilters = {
      search: q.get("search") ?? undefined,
      originalGenre: q.get("originalGenre") ?? undefined,
      effectiveGenre: q.get("effectiveGenre") ?? undefined,
      selected: bool("selected"),
      scope: (q.get("scope") as EnrichmentScope) ?? undefined,
      year: num("year"), minBpm: num("minBpm"), maxBpm: num("maxBpm"),
      availability: (q.get("availability") as "available" | "missing") ?? undefined,
      hasComment: bool("hasComment"), hasManualEnrichment: bool("hasManualEnrichment"), possibleTypo: bool("possibleTypo"),
    };
    const [data, typos] = await Promise.all([
      listMusicLibraryMetadata(prisma, sourceId, filters),
      prisma.commentTokenReview.findMany({ orderBy: [{ approved: "asc" }, { occurrences: "desc" }] }),
    ]);
    return NextResponse.json({ ...data, typos, source: device });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  try {
    // ADMIN-only internal management surface — regular users get 403.
    if (!(await getSuperAdminOrNull())) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    assertLocalDb();
    const body = await req.json();
    const action = body.action as string;

    if (action === "save-enrichment") {
      const saved = await saveEnrichment(prisma, body.localFileId as string, body.patch as EnrichmentPatch);
      return NextResponse.json({ ok: true, enrichment: saved });
    }

    if (action === "refresh") {
      const device = (body.device as string) ?? DEFAULT_DEVICE;
      const sourceId = await resolveSourceId(device);
      if (!sourceId) return NextResponse.json({ error: "unknown source" }, { status: 404 });
      const reads = (body.reads as (OriginalRead & { modifiedAt?: string })[]).map((r) => ({ ...r, modifiedAt: r.modifiedAt ? new Date(r.modifiedAt) : null }));
      const plan = await refreshFromBank(prisma, sourceId, reads, { apply: body.apply === true });
      return NextResponse.json({ ok: true, plan, applied: body.apply === true });
    }

    if (action === "approve-typo") {
      const updated = await prisma.commentTokenReview.update({ where: { rawToken: body.rawToken as string }, data: { approved: body.approved === true } });
      return NextResponse.json({ ok: true, review: updated });
    }

    if (action === "custom-field") {
      const cf = await prisma.customFieldDefinition.upsert({
        where: { name: body.name as string },
        create: { name: body.name, label: body.label, type: body.type, allowedOptions: body.allowedOptions ?? [], active: body.active ?? true, displayOrder: body.displayOrder ?? 0 },
        update: { label: body.label, type: body.type, allowedOptions: body.allowedOptions ?? [], active: body.active ?? true, displayOrder: body.displayOrder ?? 0 },
      });
      return NextResponse.json({ ok: true, customField: cf });
    }

    return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
