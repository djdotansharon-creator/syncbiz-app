import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/store";
import { getCurrentUserFromCookies, hasBranchAccess, getUserIdFromSession } from "@/lib/auth-helpers";
import { notifyLibraryUpdated } from "@/lib/broadcast-library-updated";
import type { Source } from "@/lib/types";

function resolveAccountScope(userTenantId: string): string {
  return userTenantId === "tnt-default" ? "acct-demo-001" : userTenantId;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUserFromCookies();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const source = (await db.getSources(resolveAccountScope(user.tenantId))).find((s) => s.id === id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    const branchId = source.branchId ?? "default";
    if (!(await hasBranchAccess(user.id, branchId))) {
      return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
    }
    return NextResponse.json(source);
  } catch (e) {
    console.error("[api/sources] GET error:", e);
    return NextResponse.json({ error: "Failed to load source" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUserFromCookies();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const source = (await db.getSources(resolveAccountScope(user.tenantId))).find((s) => s.id === id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    const branchId = source.branchId ?? "default";
    if (!(await hasBranchAccess(user.id, branchId))) {
      return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
    }
    const data = (await req.json()) as Partial<{ name: string; target: string; type: string; description?: string; artworkUrl?: string; browserPreference?: string }>;
    const updated = await db.updateSource(id, {
      ...(data.name != null && { name: data.name }),
      ...(data.target != null && { target: data.target, uriOrPath: data.target }),
      ...(data.type != null && { type: data.type as Source["type"] }),
      ...(data.description != null && { description: data.description }),
      ...(data.artworkUrl != null && { artworkUrl: data.artworkUrl }),
      ...(data.browserPreference != null && { browserPreference: data.browserPreference as Source["browserPreference"] }),
    });
    const userId = await getUserIdFromSession();
    if (userId) void notifyLibraryUpdated(userId, { branchId: source.branchId, entityType: "source", action: "updated" });
    return NextResponse.json(updated);
  } catch (e) {
    console.error("[api/sources] PATCH error:", e);
    return NextResponse.json({ error: "Failed to update source" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getCurrentUserFromCookies();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const source = (await db.getSources(resolveAccountScope(user.tenantId))).find((s) => s.id === id);
    if (!source) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }
    const branchId = source.branchId ?? "default";
    if (!(await hasBranchAccess(user.id, branchId))) {
      return NextResponse.json({ error: "Forbidden: no access to this branch" }, { status: 403 });
    }
    await db.deleteSource(id);
    const userId = await getUserIdFromSession();
    if (userId) void notifyLibraryUpdated(userId, { branchId: source.branchId, entityType: "source", action: "deleted" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/sources] DELETE error:", e);
    return NextResponse.json({ error: "Failed to delete source" }, { status: 500 });
  }
}
