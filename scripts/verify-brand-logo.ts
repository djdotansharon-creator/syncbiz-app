/**
 * BRAND LOGO (owner 2026-10-15) — the server accepts only real images (detected from the bytes), max 2 MB; SVG is served
 * script-free; upload / delete are manager-only (station lock applies). Run: npx tsx scripts/verify-brand-logo.ts
 */
import { readFileSync } from "fs";
import { detectLogoKind, BRAND_LOGO_MAX_BYTES } from "../lib/brand-logo";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean): void { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (cond) pass++; else { fail++; process.exitCode = 1; } }

assert("K1 PNG / JPG / WebP / SVG detected from the bytes",
  detectLogoKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) === "png" &&
  detectLogoKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])) === "jpg" &&
  detectLogoKind(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")])) === "webp" &&
  detectLogoKind(Buffer.from('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')) === "svg" &&
  detectLogoKind(Buffer.from('<svg viewBox="0 0 1 1"></svg>')) === "svg");
assert("K2 PDF, HTML, text, an .exe renamed .png → rejected",
  detectLogoKind(Buffer.from("%PDF-1.7\n")) === null && detectLogoKind(Buffer.from("<html><script>x</script></html>")) === null &&
  detectLogoKind(Buffer.from("hello")) === null && detectLogoKind(Buffer.from("MZ\x90\x00")) === null);
assert("K3 max 2 MB", BRAND_LOGO_MAX_BYTES === 2 * 1024 * 1024);
const route = readFileSync("app/api/control-room/brands/[id]/logo/route.ts", "utf8");
assert("W1 upload + delete require a manager (requireBranchManager → OWNER + station lock)", (route.match(/const auth = await requireBranchManager\(\);/g) ?? []).length === 2);
assert("W2 GET only for a signed-in user of the brand's organization", /if \(!user\) return NextResponse\.json\(\{ error: "Unauthorized" \}, \{ status: 401 \}\);/.test(route) && /brand\.workspaceId !== workspaceId/.test(route));
assert("W3 SVG served with a script-free sandbox CSP + nosniff", /sandbox"/.test(route) && /X-Content-Type-Options": "nosniff"/.test(route));
assert("W4 the file type comes from the bytes, never the name / client MIME", /const kind = detectLogoKind\(buf\);/.test(route) && !/file\.type/.test(route));
console.log(`\n${pass} passed, ${fail} failed`);
