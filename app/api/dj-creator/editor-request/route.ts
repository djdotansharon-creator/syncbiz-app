import { mkdir, appendFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ACTIVE_WORKSPACE_COOKIE_NAME } from "@/lib/active-workspace-constants";
import { getCurrentUserFromApiRequest } from "@/lib/auth-helpers";

export const dynamic = "force-dynamic";

const MAX_FREE_TEXT = 4000;

type EditorRequestPayload = {
  businessType?: string;
  daypart?: string;
  vibe?: string;
  style?: string;
  /** Warmup / Active / Peak / Mixed when gym high-energy path */
  gymIntensity?: string | null;
  /** Optional note from wizard / free composer */
  freeTextRequest?: string;
  editorMessage?: string;
};

/** Append-only NDJSON for operators — no Prisma migration; read from volume or repo `data/` */
async function appendRequestLine(record: Record<string, unknown>): Promise<{ filePath: string }> {
  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, "dj-creator-editor-requests.ndjson");
  await appendFile(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return { filePath };
}

/**
 * Fallback when catalog matches are insufficient — human editor queue (24–48h copy is client-side).
 * Does not send email or claim AI fulfillment.
 */
export async function POST(req: NextRequest) {
  const user = await getCurrentUserFromApiRequest(req);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: EditorRequestPayload;
  try {
    body = (await req.json()) as EditorRequestPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const freeTextRaw = typeof body.freeTextRequest === "string" ? body.freeTextRequest.trim() : "";
  const editorMsgRaw = typeof body.editorMessage === "string" ? body.editorMessage.trim() : "";
  const combined = editorMsgRaw || freeTextRaw;
  if (combined.length < 3) {
    return NextResponse.json({ error: "Request text too short" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const ws = cookieStore.get(ACTIVE_WORKSPACE_COOKIE_NAME)?.value?.trim() ?? "";

  const gymIntensity =
    typeof body.gymIntensity === "string" && body.gymIntensity.trim().length > 0
      ? body.gymIntensity.trim().slice(0, 80)
      : null;

  const record = {
    kind: "dj_creator_editor_request_v1",
    createdAt: new Date().toISOString(),
    userId: user.id,
    userEmail: user.email ?? null,
    workspaceId: ws.length > 0 ? ws : null,
    tenantId: user.tenantId ?? null,
    businessType: typeof body.businessType === "string" ? body.businessType.trim().slice(0, 160) : null,
    daypart: typeof body.daypart === "string" ? body.daypart.trim().slice(0, 80) : null,
    vibe: typeof body.vibe === "string" ? body.vibe.trim().slice(0, 80) : null,
    style: typeof body.style === "string" ? body.style.trim().slice(0, 160) : null,
    gymIntensity,
    freeTextRequest: freeTextRaw.slice(0, MAX_FREE_TEXT),
    editorMessage: editorMsgRaw.slice(0, MAX_FREE_TEXT),
  };
  try {
    await appendRequestLine(record);
  } catch (e) {
    console.error("[dj-creator/editor-request] append failed:", e);
    return NextResponse.json({ error: "Could not record request" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
