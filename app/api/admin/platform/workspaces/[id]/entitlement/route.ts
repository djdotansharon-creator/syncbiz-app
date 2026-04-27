/**
 * PATCH /api/admin/platform/workspaces/[id]/entitlement
 *
 * Platform-admin (`SUPER_ADMIN`) action: edit pilot limits, plan code,
 * and the free-text notes field on a workspace's entitlement row. Body
 * is partial — only fields actually provided are updated. No-op writes
 * (every provided value matches the current value) skip the audit row
 * and return 200 with `noChanges: true`.
 *
 * V1 scope (Week 4):
 * - Same transactional + audit-log pattern as Week 2 (`writePlatformAuditLog`
 *   inside `prisma.$transaction` so the entitlement state and the audit
 *   row commit together or both roll back).
 * - Validation is deliberately strict and explicit. Numeric ceilings
 *   (e.g., `MAX_BRANCHES_HARD_CAP`) are sanity checks, not product
 *   limits — the actual pilot policy is documented in
 *   `lib/user-store.ts::PILOT_LIMITS`.
 * - Status transitions live elsewhere (suspend/unsuspend routes). This
 *   endpoint will not change `status` or `trialEndsAt` even if the
 *   client tries — just ignore those fields.
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSuperAdminOrNull } from "@/lib/auth/guards";
import { extractClientIp, writePlatformAuditLog } from "@/lib/admin/platform-audit";

const MAX_BRANCHES_HARD_CAP = 100;
const MAX_DEVICES_HARD_CAP = 1000;
const MAX_USERS_HARD_CAP = 1000;
const MAX_PLAYLISTS_HARD_CAP = 5000;
const MAX_PLAN_CODE_LENGTH = 50;
const MAX_NOTES_LENGTH = 2000;

type IntField = "maxBranches" | "maxDevices" | "maxUsers" | "maxPlaylists";
const INT_FIELDS: { key: IntField; cap: number }[] = [
  { key: "maxBranches", cap: MAX_BRANCHES_HARD_CAP },
  { key: "maxDevices", cap: MAX_DEVICES_HARD_CAP },
  { key: "maxUsers", cap: MAX_USERS_HARD_CAP },
  { key: "maxPlaylists", cap: MAX_PLAYLISTS_HARD_CAP },
];

type PatchInput = {
  maxBranches?: number;
  maxDevices?: number;
  maxUsers?: number;
  maxPlaylists?: number;
  planCode?: string;
  notes?: string | null;
};

function validateBody(raw: unknown): { ok: true; data: PatchInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Body must be a JSON object" };
  const out: PatchInput = {};
  const obj = raw as Record<string, unknown>;

  for (const { key, cap } of INT_FIELDS) {
    if (obj[key] === undefined) continue;
    const v = obj[key];
    if (typeof v !== "number" || !Number.isInteger(v) || !Number.isFinite(v)) {
      return { ok: false, error: `\`${key}\` must be an integer` };
    }
    if (v < 0 || v > cap) {
      return { ok: false, error: `\`${key}\` must be between 0 and ${cap}` };
    }
    out[key] = v;
  }

  if (obj.planCode !== undefined) {
    if (typeof obj.planCode !== "string") {
      return { ok: false, error: "`planCode` must be a string" };
    }
    const trimmed = obj.planCode.trim();
    if (trimmed.length === 0) {
      return { ok: false, error: "`planCode` cannot be empty" };
    }
    if (trimmed.length > MAX_PLAN_CODE_LENGTH) {
      return { ok: false, error: `\`planCode\` must be ${MAX_PLAN_CODE_LENGTH} characters or less` };
    }
    out.planCode = trimmed;
  }

  if (obj.notes !== undefined) {
    if (obj.notes === null) {
      out.notes = null;
    } else if (typeof obj.notes === "string") {
      if (obj.notes.length > MAX_NOTES_LENGTH) {
        return { ok: false, error: `\`notes\` must be ${MAX_NOTES_LENGTH} characters or less` };
      }
      // Preserve user whitespace inside notes; only trim outer.
      const trimmed = obj.notes.trim();
      out.notes = trimmed.length > 0 ? trimmed : null;
    } else {
      return { ok: false, error: "`notes` must be a string or null" };
    }
  }

  return { ok: true, data: out };
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const admin = await getSuperAdminOrNull();
  if (!admin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: workspaceId } = await params;
  if (!workspaceId?.trim()) {
    return NextResponse.json({ error: "Missing workspace id" }, { status: 400 });
  }

  let body: PatchInput;
  try {
    const raw = await req.json().catch(() => null);
    const v = validateBody(raw);
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 });
    body = v.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (Object.keys(body).length === 0) {
    return NextResponse.json({ error: "No editable fields provided" }, { status: 400 });
  }

  const ipAddress = extractClientIp(req);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const ws = await tx.workspace.findUnique({
        where: { id: workspaceId },
        select: { id: true, name: true },
      });
      if (!ws) return { kind: "not_found" as const };

      const before = await tx.workspaceEntitlement.findUnique({
        where: { workspaceId },
      });
      if (!before) return { kind: "no_entitlement" as const };

      // Build a diff so the audit metadata only carries fields that
      // actually changed. This keeps the log readable and skips audit
      // rows entirely when the PATCH is a no-op. `from`/`to` types
      // are constrained to JSON-serialisable primitives so the diff
      // survives a round-trip through Prisma's `Json` column.
      type DiffPrimitive = string | number | null;
      const changes: Record<string, { from: DiffPrimitive; to: DiffPrimitive }> = {};
      const updateData: Record<string, string | number | null> = {};
      const fields: (keyof PatchInput)[] = [
        "maxBranches",
        "maxDevices",
        "maxUsers",
        "maxPlaylists",
        "planCode",
        "notes",
      ];
      for (const f of fields) {
        if (body[f] === undefined) continue;
        const rawCur = (before as Record<string, unknown>)[f];
        const cur: DiffPrimitive =
          rawCur === null || rawCur === undefined
            ? null
            : typeof rawCur === "number" || typeof rawCur === "string"
              ? rawCur
              : String(rawCur);
        const next: DiffPrimitive = body[f] ?? null;
        if (next !== cur) {
          changes[f] = { from: cur, to: next };
          updateData[f] = body[f] ?? null;
        }
      }

      if (Object.keys(changes).length === 0) {
        return { kind: "no_changes" as const, entitlement: before };
      }

      const updated = await tx.workspaceEntitlement.update({
        where: { workspaceId },
        data: updateData,
      });

      await writePlatformAuditLog(tx, {
        action: "entitlement.update_limits",
        actorUserId: admin.id,
        targetWorkspaceId: workspaceId,
        ipAddress,
        metadata: {
          workspaceName: ws.name,
          changes,
        },
      });

      return { kind: "ok" as const, entitlement: updated };
    });

    if (result.kind === "not_found") {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }
    if (result.kind === "no_entitlement") {
      return NextResponse.json(
        { error: "Workspace has no entitlement row. Run the backfill script first." },
        { status: 409 },
      );
    }
    if (result.kind === "no_changes") {
      return NextResponse.json(
        { ok: true, noChanges: true, entitlement: result.entitlement },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true, entitlement: result.entitlement }, { status: 200 });
  } catch (e) {
    console.error("[admin/platform/entitlement] PATCH error:", e);
    return NextResponse.json({ error: "Failed to update entitlement" }, { status: 500 });
  }
}
