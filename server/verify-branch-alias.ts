/**
 * CONTROL ROOM PHASE 1 / GATE 1 — WS branch alias is SHADOW ONLY.
 * Proves: the runtime mode is the code constant "shadow"; shadow/off never change the effective branch or room;
 * the alias sync body is validated; REGISTER computes its room from the RAW branch and the shadow hook only logs;
 * the alias endpoint never touches designation / lease / rooms.
 * Run (from server/): npx tsx verify-branch-alias.ts
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  BRANCH_ALIAS_RUNTIME_MODE,
  applyAliasSync,
  decideBranchAlias,
  parseAliasSyncBody,
  type BranchAliases,
} from "./branch-alias.js";
import { runtimeBranchKey } from "./branch-room.js";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, "index.ts"), "utf-8").replace(/\r\n/g, "\n");
const mod = readFileSync(join(here, "branch-alias.ts"), "utf-8").replace(/\r\n/g, "\n");

const WS = "31d30e23-8f4a-4bf2-a1df-c707b69b5673";
const CANON = "9a1b2c3d-0000-4000-8000-000000000001";
const aliases: BranchAliases = { [WS]: { default: CANON } };

// ── runtime mode is an explicit code constant ────────────────────────────────────────────────────────────────
assert("runtime mode constant is 'shadow'", BRANCH_ALIAS_RUNTIME_MODE === "shadow");
assert("mode is NOT read from env (cannot be flipped by config)",
  /export const BRANCH_ALIAS_RUNTIME_MODE: BranchAliasMode = "shadow";/.test(mod) && !/process\.env\.[A-Z_]*ALIAS/.test(mod));

// ── pure decision ────────────────────────────────────────────────────────────────────────────────────────────
const sh = decideBranchAlias({ mode: "shadow", workspaceId: WS, rawBranchId: "default", aliases });
assert("shadow: candidate computed", sh.candidateBranchId === CANON);
assert("shadow: EFFECTIVE branch stays raw 'default'", sh.effectiveBranchId === "default");
assert("shadow: effective room unchanged ws:<ws>:default",
  runtimeBranchKey(WS, "", sh.effectiveBranchId) === `ws:${WS}:default`);
assert("shadow: empty raw normalizes to 'default' (same as today) and stays effective",
  decideBranchAlias({ mode: "shadow", workspaceId: WS, rawBranchId: "", aliases }).effectiveBranchId === "default");
assert("shadow: unknown workspace → no candidate, raw kept",
  (() => { const d = decideBranchAlias({ mode: "shadow", workspaceId: "other", rawBranchId: "default", aliases }); return d.candidateBranchId === null && d.effectiveBranchId === "default"; })());
assert("shadow: non-legacy branch untouched",
  decideBranchAlias({ mode: "shadow", workspaceId: WS, rawBranchId: "branch-x", aliases }).effectiveBranchId === "branch-x");
assert("shadow: no workspace (legacy token) → raw kept",
  decideBranchAlias({ mode: "shadow", workspaceId: null, rawBranchId: "default", aliases }).effectiveBranchId === "default");
assert("off: no candidate, raw kept",
  (() => { const d = decideBranchAlias({ mode: "off", workspaceId: WS, rawBranchId: "default", aliases }); return d.candidateBranchId === null && d.effectiveBranchId === "default"; })());
assert("(Gate 2 semantics, not wired) active would map default → canonical",
  decideBranchAlias({ mode: "active", workspaceId: WS, rawBranchId: "default", aliases }).effectiveBranchId === CANON);

// ── sync body validation ─────────────────────────────────────────────────────────────────────────────────────
assert("valid sync body accepted", JSON.stringify(parseAliasSyncBody({ workspaceId: WS, legacyKey: "default", canonicalBranchId: CANON })) ===
  JSON.stringify({ workspaceId: WS, legacyKey: "default", canonicalBranchId: CANON }));
assert("null canonical = remove", parseAliasSyncBody({ workspaceId: WS, legacyKey: "default", canonicalBranchId: null })?.canonicalBranchId === null);
assert("invalid bodies rejected",
  parseAliasSyncBody(null) === null && parseAliasSyncBody({}) === null &&
  parseAliasSyncBody({ workspaceId: "../x", legacyKey: "default", canonicalBranchId: CANON }) === null &&
  parseAliasSyncBody({ workspaceId: WS, legacyKey: "default", canonicalBranchId: "default" }) === null &&
  parseAliasSyncBody({ workspaceId: WS, legacyKey: "default", canonicalBranchId: "a b" }) === null);
const added = applyAliasSync({}, { workspaceId: WS, legacyKey: "default", canonicalBranchId: CANON });
const removed = applyAliasSync(added, { workspaceId: WS, legacyKey: "default", canonicalBranchId: null });
assert("apply add/remove", added[WS]?.default === CANON && Object.keys(removed).length === 0);

// ── STATIC: REGISTER routing unchanged; hook is log-only; endpoint never touches routing state ────────────────
const devReg = src.indexOf('logBranchAliasShadow({ role: "device"');
const ctlReg = src.indexOf('logBranchAliasShadow({ role: "controller"');
assert("device REGISTER: room computed from RAW branch BEFORE the shadow hook",
  devReg > 0 && /const roomKey = runtimeBranchKey\(workspaceId, userId, branchId\);\n\s*logBranchAliasShadow\(\{ role: "device"/.test(src));
assert("controller REGISTER: room computed from RAW branch BEFORE the shadow hook",
  ctlReg > 0 && /const roomKey = runtimeBranchKey\(workspaceId, userId, branchId\);\n\s*logBranchAliasShadow\(\{ role: "controller"/.test(src));
const hook = src.slice(src.indexOf("function logBranchAliasShadow("), src.indexOf("/** Persist the authoritative designations"));
assert("shadow hook only logs (no assignment to room/branch/designation/lease state)",
  hook.length > 100 && /console\.log\(\s*"\[SyncBiz WS\]\[branch-alias\] shadow"/.test(hook) &&
  !/designatedByRoom|masterByBranch|primaryMasterByBranch|devices\.|controllers\.|roomKey\s*=|branchId\s*=/.test(hook));
const ep = src.slice(src.indexOf('req.url === "/internal/branch-alias"'), src.indexOf("res.writeHead(404);"));
assert("alias endpoint is secret-gated", /if \(secret !== WS_SECRET\)/.test(ep));
assert("alias endpoint never touches designation / lease / rooms / devices",
  ep.length > 100 && !/designatedByRoom|authoritativeDesignationRooms|clearedDesignationRooms|masterByBranch|persistMasterLease|persistDesignations|revokeCurrentDesignatedMaster|devices\.|broadcastDeviceList/.test(ep));
assert("no other code path consumes the alias decision for routing",
  (src.match(/decideBranchAlias\(/g) ?? []).length === 1 && !/effectiveBranchId\s*[),;]/.test(src.replace(/effectiveBranchId: d\.effectiveBranchId/g, "")));

console.log(`\n${pass} passed, ${fail} failed`);
