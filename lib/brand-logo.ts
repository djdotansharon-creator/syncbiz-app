/**
 * BRAND LOGO files (owner 2026-10-15) — one logo per brand, stored on the app volume next to the jingles
 * (`$RAILWAY_VOLUME_MOUNT_PATH/brand-logos/<brandId>.<ext>`, local dev: data/brand-logos). Brand.logoUrl (existing
 * column — no migration) points at the serving route with a cache-busting version.
 * Accepted: PNG, JPEG, WebP, SVG — detected from the BYTES, never from the file name / client MIME. Max 2 MB.
 * (PDF is a document, not an image a page can display → convert it to PNG / SVG once.)
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";

export const BRAND_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export type LogoKind = "png" | "jpg" | "webp" | "svg";
const KINDS: LogoKind[] = ["png", "jpg", "webp", "svg"];
export const LOGO_CONTENT_TYPE: Record<LogoKind, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml" };

function logoDir(): string {
  const vol = process.env.RAILWAY_VOLUME_MOUNT_PATH;
  return vol ? join(vol, "brand-logos") : join(process.cwd(), "data", "brand-logos");
}
const safeId = (id: string) => id.replace(/[^a-zA-Z0-9-]/g, "");

/** What the bytes really are (null = not an accepted image). */
export function detectLogoKind(buf: Buffer): LogoKind | null {
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return "png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  const head = buf.toString("utf8", 0, Math.min(buf.length, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
  if ((head.startsWith("<svg") || head.startsWith("<?xml")) && head.includes("<svg")) return "svg";
  return null;
}

export function saveBrandLogo(brandId: string, buf: Buffer, kind: LogoKind): void {
  const dir = logoDir();
  mkdirSync(dir, { recursive: true });
  removeBrandLogo(brandId);
  writeFileSync(join(dir, `${safeId(brandId)}.${kind}`), buf);
}

export function removeBrandLogo(brandId: string): void {
  for (const k of KINDS) {
    const p = join(logoDir(), `${safeId(brandId)}.${k}`);
    if (existsSync(p)) unlinkSync(p);
  }
}

export function readBrandLogo(brandId: string): { buf: Buffer; kind: LogoKind } | null {
  for (const k of KINDS) {
    const p = join(logoDir(), `${safeId(brandId)}.${k}`);
    if (existsSync(p)) return { buf: readFileSync(p), kind: k };
  }
  return null;
}

export function brandLogoUrl(brandId: string): string {
  return `/api/control-room/brands/${encodeURIComponent(brandId)}/logo?v=${Date.now()}`;
}
