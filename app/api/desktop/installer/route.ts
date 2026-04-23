import { createReadStream, statSync, existsSync } from "fs";
import { Readable } from "node:stream";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Streams the Windows installer .exe from `DESKTOP_INSTALLER_BUNDLE_PATH` (absolute path
 * on the server). Use with GET `/api/desktop/download` which returns
 * `url: <origin>/api/desktop/installer` and matching fileName/version.
 */
function resolveInstallerPath(): string | null {
  const raw = process.env.DESKTOP_INSTALLER_BUNDLE_PATH?.trim();
  if (!raw) return null;
  const abs = path.resolve(raw);
  if (!abs.toLowerCase().endsWith(".exe")) return null;
  if (!existsSync(abs)) return null;
  return abs;
}

export async function GET(req: Request) {
  const p = resolveInstallerPath();
  if (!p) {
    return NextResponse.json({ error: "Installer bundle is not configured or file missing" }, { status: 404 });
  }
  const fileName = process.env.DESKTOP_WIN_INSTALLER_FILE_NAME?.trim() || path.basename(p);
  let size: number;
  try {
    size = statSync(p).size;
  } catch {
    return NextResponse.json({ error: "Installer not readable" }, { status: 500 });
  }

  const source = createReadStream(p);
  const body = Readable.toWeb(source);
  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.microsoft.portable-executable",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      "Content-Length": String(size),
      "Cache-Control": "no-store",
    },
  });
}
