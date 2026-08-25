import { createReadStream, statSync, existsSync } from "fs";
import { Readable } from "node:stream";
import path from "path";
import { NextResponse } from "next/server";
import { resolveLatestWindowsInstaller } from "@/lib/desktop-installer-resolve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * SyncBiz-owned download entry for the Windows installer .exe. Behavior:
 *   1. If `DESKTOP_INSTALLER_BUNDLE_PATH` points at a readable .exe → stream it (attachment).
 *   2. Otherwise → 307-redirect to the latest published GitHub release .exe asset (which serves
 *      with its own attachment disposition, so the browser downloads it directly).
 *   3. If neither is available → 404 JSON.
 * Either way the browser gets an .exe download and never sees the GitHub Releases UI.
 */
function resolveInstallerPath(): string | null {
  const raw = process.env.DESKTOP_INSTALLER_BUNDLE_PATH?.trim();
  if (!raw) return null;
  const abs = path.resolve(raw);
  if (!abs.toLowerCase().endsWith(".exe")) return null;
  if (!existsSync(abs)) return null;
  return abs;
}

export async function GET(_req: Request) {
  const p = resolveInstallerPath();
  if (!p) {
    // No local bundle on this server → hand off to the latest GitHub release .exe (SyncBiz stays
    // the public URL; the client never sees a GitHub page).
    const latest = await resolveLatestWindowsInstaller();
    if (latest) return NextResponse.redirect(latest.url, 307);
    return NextResponse.json({ error: "No Windows installer is available yet." }, { status: 404 });
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
