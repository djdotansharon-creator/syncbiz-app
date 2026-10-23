/**
 * BRANCH LOGO files (owner 2026-10-19) — one optional logo per branch, stored on the app volume next to the brand logos
 * (`$RAILWAY_VOLUME_MOUNT_PATH/branch-logos/<branchId>.<ext>`, local dev: data/branch-logos). NO database column / migration: whether a branch
 * has a logo is simply whether its file exists (the file's mtime is the cache-busting version). Same accepted formats, size limit and byte
 * sniffing as the brand logos (lib/brand-logo.ts). The branch list shows this logo in place of the brand's logo / letter tile.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import type { LogoKind } from "@/lib/brand-logo";

const KINDS: LogoKind[] = ["png", "jpg", "webp", "svg"];

function logoDir(): string {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return vol ? join(vol, "branch-logos") : join(process.cwd(), "data", "branch-logos");
}
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "");

export function saveBranchLogo(branchId: string, buf: Buffer, kind: LogoKind): void {
  const dir = logoDir();
  mkdirSync(dir, { recursive: true });
  removeBranchLogo(branchId);
  writeFileSync(join(dir, `${safeId(branchId)}.${kind}`), buf);
}

export function removeBranchLogo(branchId: string): void {
  for (const k of KINDS) {
    const p = join(logoDir(), `${safeId(branchId)}.${k}`);
    if (existsSync(p)) unlinkSync(p);
  }
}

export function readBranchLogo(branchId: string): { buf: Buffer; kind: LogoKind } | null {
  for (const k of KINDS) {
    const p = join(logoDir(), `${safeId(branchId)}.${k}`);
    if (existsSync(p)) return { buf: readFileSync(p), kind: k };
  }
  return null;
}

/** the serving URL, versioned by the file's mtime (a replaced logo shows at once) */
export function branchLogoUrl(branchId: string, version: number): string {
  return `/api/control-room/branches/${encodeURIComponent(branchId)}/logo?v=${Math.round(version)}`;
}

/** every branch id that has a logo → its version (one directory listing — used by the branch list) */
export function branchLogoVersions(): Map<string, number> {
  const out = new Map<string, number>();
  const dir = logoDir();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir)) {
    const m = /^([a-zA-Z0-9-]+)\.(png|jpg|webp|svg)$/.exec(f);
    if (!m) continue;
    try { out.set(m[1], statSync(join(dir, f)).mtimeMs); } catch { /* vanished */ }
  }
  return out;
}
