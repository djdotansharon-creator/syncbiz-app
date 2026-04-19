import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

function jinglesDir(): string {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return vol ? join(vol, "jingles") : join(process.cwd(), "data", "jingles");
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: rawId } = await params;
  // Strip everything except UUID-safe characters to prevent path traversal
  const id = (rawId ?? "").replace(/[^a-f0-9-]/gi, "");
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const filePath = join(jinglesDir(), `${id}.mp3`);
  if (!existsSync(filePath)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buf = await readFile(filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Content-Length": String(buf.byteLength),
      "Cache-Control": "private, max-age=86400",
      "Accept-Ranges": "bytes",
    },
  });
}
