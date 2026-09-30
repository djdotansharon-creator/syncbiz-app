/**
 * Regression — the Desktop config UI must NOT assert the durable device identity.
 *
 * Phase 0.1 makes C:\ProgramData\VONO\state\device-id.json the authoritative MAIN identity (SAVE_CONFIG strips
 * deviceId + reconciles). This guard proves the renderer config form (a) never sends deviceId in a SAVE_CONFIG
 * patch, and (b) keeps the Device ID field display-only (readonly). Display + fillForm + stDeviceId are preserved.
 *
 * Run: npx tsx desktop/scripts/verify-device-id-ui-readonly.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const root = path.join(__dirname, "..");

const rendererSrc = readFileSync(path.join(root, "src/renderer/renderer.ts"), "utf-8");
const htmlSrc = readFileSync(path.join(root, "src/renderer/index.html"), "utf-8");

// ── readPatchFromForm must NOT include deviceId ───────────────────────────────────────────────────────────────
const fnStart = rendererSrc.indexOf("function readPatchFromForm");
assert("readPatchFromForm exists", fnStart >= 0);
const fnBody = rendererSrc.slice(fnStart, rendererSrc.indexOf("\n}", fnStart) + 2);
assert("readPatchFromForm does NOT send deviceId", !/deviceId/.test(fnBody), fnBody.match(/deviceId/)?.[0] ?? "");
assert("readPatchFromForm returns the patch type (MvpConfigPatch), not full config",
  /function readPatchFromForm\(\): MvpConfigPatch/.test(rendererSrc));
// Sanity: it still sends the legitimately-editable fields.
assert("readPatchFromForm still sends branchId/apiBaseUrl/wsUrl/wsToken",
  /branchId:/.test(fnBody) && /apiBaseUrl:/.test(fnBody) && /wsUrl:/.test(fnBody) && /wsToken:/.test(fnBody));

// ── Device ID stays display-only ──────────────────────────────────────────────────────────────────────────────
const deviceInput = htmlSrc.split("\n").find((l) => /id="deviceId"/.test(l)) ?? "";
assert("#deviceId input exists", deviceInput.length > 0);
assert("#deviceId input is readonly", /\breadonly\b/.test(deviceInput), deviceInput.trim());
assert("#deviceId input is not contenteditable/editable-typed", !/contenteditable/i.test(deviceInput));

// ── Display paths preserved ───────────────────────────────────────────────────────────────────────────────────
assert("fillForm still populates the Device ID field (display)", /el<HTMLInputElement>\("deviceId"\)\.value\s*=/.test(rendererSrc));
assert("stDeviceId status display preserved", /stDeviceId/.test(rendererSrc));

console.log(`\n${pass} passed, ${fail} failed`);
