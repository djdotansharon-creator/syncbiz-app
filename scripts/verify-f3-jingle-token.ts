/**
 * F3 deterministic unit test — jingle access token (lib/jingles/jingle-token.ts).
 * Run: SYNCBIZ_MEDIA_SECRET=<min16> npx tsx scripts/verify-f3-jingle-token.ts
 */
import { createHmac } from "node:crypto";

process.env.SYNCBIZ_MEDIA_SECRET ||= "test-secret-at-least-16-chars-long";
const SECRET = process.env.SYNCBIZ_MEDIA_SECRET!;

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); }
}

async function main(): Promise<void> {
  const { mintJingleToken, verifyJingleToken } = await import("../lib/jingles/jingle-token");

  // 1 — mint + verify round-trip, workspace preserved
  const { token, exp } = mintJingleToken("ws-A");
  const claims = verifyJingleToken(token);
  ok("mint→verify returns claims", claims !== null);
  ok("workspaceId preserved", claims?.workspaceId === "ws-A");
  ok("purpose is jingle_access", claims?.purpose === "jingle_access");
  ok("exp is in the future", exp > Math.floor(Date.now() / 1000));

  // 2 — tampered signature → null
  const [b64] = token.split(".");
  ok("tampered signature rejected", verifyJingleToken(`${b64}.deadbeef`) === null);

  // 3 — tampered payload (change workspace) with the OLD sig → null
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b64, "base64url").toString()), workspaceId: "ws-B" }), "utf-8").toString("base64url");
  ok("tampered payload rejected", verifyJingleToken(`${forged}.${token.split(".")[1]}`) === null);

  // 4 — cross-token replay: a VALID media-shaped token (purpose media_access, correctly signed with
  //     the SAME secret) must NOT verify as a jingle token.
  const mediaPayload = Buffer.from(JSON.stringify({
    purpose: "media_access", workspaceId: "ws-A", deviceId: "d", accessMode: "preview",
    allowedGenres: [], iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, sid: "x",
  }), "utf-8").toString("base64url");
  const mediaSig = createHmac("sha256", SECRET).update(mediaPayload).digest("base64url");
  ok("media token NOT accepted as jingle token", verifyJingleToken(`${mediaPayload}.${mediaSig}`) === null);

  // 5 — expired token → null (craft exp in the past, sign correctly)
  const expPayload = Buffer.from(JSON.stringify({
    purpose: "jingle_access", workspaceId: "ws-A",
    iat: Math.floor(Date.now() / 1000) - 7200, exp: Math.floor(Date.now() / 1000) - 10, sid: "x",
  }), "utf-8").toString("base64url");
  const expSig = createHmac("sha256", SECRET).update(expPayload).digest("base64url");
  ok("expired token rejected", verifyJingleToken(`${expPayload}.${expSig}`) === null);

  // 6 — malformed inputs → null (no throw)
  ok("empty string rejected", verifyJingleToken("") === null);
  ok("no-dot rejected", verifyJingleToken("abc") === null);

  // 7 — mint requires a workspaceId
  let threw = false;
  try { mintJingleToken(""); } catch { threw = true; }
  ok("mint throws without workspaceId", threw);

  // 8 — fail-closed when the secret is missing
  const saved = process.env.SYNCBIZ_MEDIA_SECRET;
  delete process.env.SYNCBIZ_MEDIA_SECRET;
  ok("verify returns null when secret missing", verifyJingleToken(token) === null);
  let mintThrew = false;
  try { mintJingleToken("ws-A"); } catch { mintThrew = true; }
  ok("mint throws when secret missing", mintThrew);
  process.env.SYNCBIZ_MEDIA_SECRET = saved;

  // 9 — short secret (<16) → fail closed on verify
  process.env.SYNCBIZ_MEDIA_SECRET = "short";
  ok("verify returns null when secret too short", verifyJingleToken(token) === null);
  process.env.SYNCBIZ_MEDIA_SECRET = saved;

  console.log(`\nF3 jingle-token: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
