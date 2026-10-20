import { NextRequest, NextResponse } from "next/server";
import { requireBranchManager } from "@/lib/control-room-auth";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { db } from "@/lib/store";
import { BRAND_LOGO_MAX_BYTES, LOGO_CONTENT_TYPE, brandLogoUrl, detectLogoKind, readBrandLogo, removeBrandLogo, saveBrandLogo } from "@/lib/brand-logo";

/**
 * Control Room — a brand's LOGO (owner 2026-10-15).
 *  GET    → the image (signed-in user of the brand's organization)
 *  POST   multipart "file" → upload / replace (owner / manager; station lock applies via requireBranchManager)
 *  DELETE → remove the logo (back to the colour dot)
 */
export const dynamic = "force-dynamic";

async function brandOf(workspaceId: string, id: string) {
  return prisma.brand.findFirst({ where: { id, workspaceId, archivedAt: null }, select: { id: true } });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUserFromCookies();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const brand = await prisma.brand.findFirst({ where: { id, archivedAt: null }, select: { id: true, workspaceId: true } });
  // same account → workspace resolution as the Control Room guard
  const workspaceId = await db.resolveWorkspaceIdForAccount(user.tenantId === "tnt-default" ? "acct-demo-001" : user.tenantId);
  if (!brand || !workspaceId || brand.workspaceId !== workspaceId) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const file = readBrandLogo(brand.id);
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const headers: Record<string, string> = {
    "Content-Type": LOGO_CONTENT_TYPE[file.kind],
    "Content-Length": String(file.buf.byteLength),
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
  };
  // an SVG opened directly as a page can never run script
  if (file.kind === "svg") headers["Content-Security-Policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
  return new NextResponse(new Uint8Array(file.buf), { headers });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!(await brandOf(auth.workspaceId, id))) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  let file: File | null = null;
  try {
    const form = await req.formData();
    const f = form.get("file");
    file = f instanceof File ? f : null;
  } catch {
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Choose a logo file." }, { status: 400 });
  if (file.size > BRAND_LOGO_MAX_BYTES) return NextResponse.json({ error: "The logo must be 2 MB or smaller." }, { status: 413 });
  const buf = Buffer.from(await file.arrayBuffer());
  const kind = detectLogoKind(buf);
  if (!kind) return NextResponse.json({ error: "Use a PNG, JPG, WebP or SVG image (PDF is not an image — export it as PNG or SVG)." }, { status: 415 });
  saveBrandLogo(id, buf, kind);
  const logoUrl = brandLogoUrl(id);
  await prisma.brand.update({ where: { id }, data: { logoUrl } });
  return NextResponse.json({ ok: true, logoUrl });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireBranchManager();
  if (!auth.ok) return auth.response;
  const { id } = await params;
  if (!(await brandOf(auth.workspaceId, id))) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
  removeBrandLogo(id);
  await prisma.brand.update({ where: { id }, data: { logoUrl: null } });
  return NextResponse.json({ ok: true });
}
