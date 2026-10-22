// READ-ONLY end-to-end playback test for the shufersal bank against the LIVE app.
// Mints a media-session token (HMAC with the live SYNCBIZ_MEDIA_SECRET, injected via
// `railway run -s syncbiz-app`), then for N random shufersal tracks: GET /api/media/<id>?mt=<token>
// (manual redirect) → expect 302 to an R2 signed URL → fetch that URL with Range → expect 206 + bytes.
// Nothing is written anywhere.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.TEST_BASE_URL || "https://syncbiz-app-production.up.railway.app";
const N = Number(process.env.N || 5);

const secret = process.env.SYNCBIZ_MEDIA_SECRET;
if (!secret || secret.length < 16) { console.error("no SYNCBIZ_MEDIA_SECRET in env"); process.exit(1); }

const b64url = (buf) => Buffer.from(buf).toString("base64url");
function mintToken(allowedGenres) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { purpose: "media_access", workspaceId: "playback-test", deviceId: "playback-test",
    accessMode: "preview", allowedGenres, iat: now, exp: now + 1800, sid: crypto.randomBytes(9).toString("base64url") };
  const b = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret).update(b).digest("base64url");
  return `${b}.${sig}`;
}

const exp = JSON.parse(fs.readFileSync(path.join(DIR, "shufersal-export.json"), "utf8"));
const ids = exp.mediaAsset.map((r) => r.logicalId);
// pick N random
const pick = [];
const pool = [...ids];
for (let i = 0; i < Math.min(N, pool.length); i++) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);

const token = mintToken(["shufersal-demo"]);
const results = [];
for (const id of pick) {
  const r = { id };
  try {
    const url = `${BASE}/api/media/${encodeURIComponent(id)}?mt=${encodeURIComponent(token)}`;
    const res = await fetch(url, { redirect: "manual" });
    r.mediaStatus = res.status;
    const loc = res.headers.get("location");
    r.redirectedToR2 = !!loc && /r2\.cloudflarestorage\.com/.test(loc);
    if (loc) {
      const r2 = await fetch(loc, { headers: { Range: "bytes=0-1023" } });
      r.r2Status = r2.status;
      const buf = Buffer.from(await r2.arrayBuffer());
      r.bytes = buf.length;
      r.looksLikeMp3 = buf.length >= 2 && (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33 /*ID3*/ || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) /*MPEG frame*/);
      r.contentType = r2.headers.get("content-type");
    }
    r.ok = r.mediaStatus === 302 && r.redirectedToR2 && r.r2Status === 206 && r.bytes > 0;
  } catch (e) { r.error = (e?.message || String(e)).slice(0, 160); r.ok = false; }
  results.push(r);
}
// also prove scope enforcement: a token WITHOUT shufersal-demo must be 403
let scopeDenied = null;
try {
  const bad = mintToken(["dance"]);
  const res = await fetch(`${BASE}/api/media/${encodeURIComponent(pick[0])}?mt=${encodeURIComponent(bad)}`, { redirect: "manual" });
  scopeDenied = res.status; // expect 403 (asset genre shufersal-demo not in token's allowedGenres)
} catch { /* ignore */ }

const passed = results.filter((r) => r.ok).length;
console.log(JSON.stringify({ base: BASE, tested: results.length, passed, failed: results.length - passed, scopeCheck_expect403: scopeDenied, results }, null, 1));
process.exitCode = passed === results.length ? 0 : 1;
