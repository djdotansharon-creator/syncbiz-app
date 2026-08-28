/**
 * Server-only R2 (S3-compatible) presigned GET URL minting for the Music Bank media transport.
 *
 * Why a dedicated lib (not the ingest script, not an SDK):
 *  - The production /api/media route must NOT depend on a test-only script (scripts/music-bank/*).
 *  - We only need ONE operation here — a presigned GET — so a full S3 SDK is dead weight in the
 *    serverless bundle. Custom SigV4 query-presigning (Node crypto, zero deps) is minimal + lean and
 *    is the same scheme already proven end-to-end against R2 (spike + ingest).
 *
 * NEVER runs on the client. Reads credentials from server env only. The returned URL carries an
 * X-Amz-Signature — treat it as a short-lived secret: it must reach ONLY the MASTER (via the 302),
 * never CONTROL, never WS, never a log (see redactMediaToken).
 */

import crypto from "node:crypto";

export type R2Config = {
  accessKeyId: string;
  secretAccessKey: string;
  /** Account S3 endpoint, e.g. https://<account>.r2.cloudflarestorage.com (no trailing slash). */
  endpoint: string;
};

/** Read R2 credentials from server env. Returns null if ANY piece is missing → route fails closed (503). */
export function getR2Config(): R2Config | null {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const endpoint = process.env.R2_S3_ENDPOINT?.trim();
  if (!accessKeyId || !secretAccessKey || !endpoint) return null;
  return { accessKeyId, secretAccessKey, endpoint: endpoint.replace(/\/$/, "") };
}

const DEFAULT_TTL_SEC = 60 * 60; // 1 h — covers a full track plus any forward/backward Range seeks.
const MAX_TTL_SEC = 6 * 60 * 60; // 6 h hard cap.

/** Presigned-URL lifetime. A fresh URL is minted on every /api/media hit (every track load), so this
 *  only needs to outlast ONE track's playback + seeks; 1 h is generous yet bounded. Env-overridable. */
export function r2PresignTtlSec(): number {
  const raw = Number(process.env.SYNCBIZ_MEDIA_R2_TTL_SEC);
  return Number.isFinite(raw) && raw >= 60 && raw <= MAX_TTL_SEC ? Math.floor(raw) : DEFAULT_TTL_SEC;
}

function awsUriEncode(str: string, encodeSlash: boolean): string {
  let out = "";
  for (const b of Buffer.from(str, "utf8")) {
    const c = String.fromCharCode(b);
    if ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || "-_.~".includes(c)) out += c;
    else if (c === "/" && !encodeSlash) out += "/";
    else out += "%" + b.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

const sha256Hex = (x: string) => crypto.createHash("sha256").update(x).digest("hex");
const hmac = (key: crypto.BinaryLike, x: string) => crypto.createHmac("sha256", key).update(x).digest();

/**
 * Mint a presigned GET URL for `bucket/objectKey` on R2 (path-style, region "auto"). Range requests
 * work on the returned URL (the Range header is not part of the signature), so MPV seeks freely.
 */
export function presignGet(cfg: R2Config, bucket: string, objectKey: string, ttlSec: number): string {
  const host = new URL(cfg.endpoint).host;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  const date = amzDate.slice(0, 8);
  const canonicalUri = "/" + awsUriEncode(bucket, true) + "/" + awsUriEncode(objectKey, false);
  const credential = `${cfg.accessKeyId}/${date}/auto/s3/aws4_request`;
  const query = new Map<string, string>([
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", credential],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(Math.min(Math.max(60, Math.floor(ttlSec)), MAX_TTL_SEC))],
    ["X-Amz-SignedHeaders", "host"],
  ]);
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => awsUriEncode(k, true) + "=" + awsUriEncode(v, true))
    .sort()
    .join("&");
  const canonicalRequest = ["GET", canonicalUri, canonicalQuery, `host:${host}\n`, "host", "UNSIGNED-PAYLOAD"].join("\n");
  const scope = `${date}/auto/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonicalRequest)].join("\n");
  let k = hmac("AWS4" + cfg.secretAccessKey, date);
  k = hmac(k, "auto");
  k = hmac(k, "s3");
  k = hmac(k, "aws4_request");
  const signature = crypto.createHmac("sha256", k).update(stringToSign).digest("hex");
  return `${cfg.endpoint}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
