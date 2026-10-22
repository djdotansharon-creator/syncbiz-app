/**
 * CONTROL ROOM GATE 3A — capability engine (SHADOW). Proves presets, scope, active-workspace resolution, fail-closed
 * cases, and that SHADOW never blocks. Uses an in-memory fake Prisma (installed BEFORE the modules load).
 * Run: npx tsx scripts/verify-gate3a-authz.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");

const WS = "31d30e23-8f4a-4bf2-a1df-c707b69b5673";
const CANON = "90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2";
const WS_B = "ws-bbbb";
const CANON_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const OTHER_BRANCH = "branch-other-in-ws";

// ── fake Prisma (membership / assignments / branches) ────────────────────────────────────────────────────────
const members: { workspaceId: string; userId: string; role: string; status: string }[] = [];
const assignments: { workspaceId: string; userId: string; branchId: string; role: string }[] = [];
const branches = [
  { id: CANON, workspaceId: WS, legacyKey: "default" },
  { id: OTHER_BRANCH, workspaceId: WS, legacyKey: null },
  { id: CANON_B, workspaceId: WS_B, legacyKey: "default" },
];
(globalThis as unknown as { prisma: unknown }).prisma = {
  workspaceMember: {
    findUnique: async ({ where }: { where: { workspaceId_userId: { workspaceId: string; userId: string } } }) => {
      const k = where.workspaceId_userId;
      const m = members.find((x) => x.workspaceId === k.workspaceId && x.userId === k.userId);
      return m ? { role: m.role, status: m.status } : null;
    },
  },
  userBranchAssignment: {
    findMany: async ({ where }: { where: { workspaceId: string; userId: string } }) =>
      assignments.filter((a) => a.workspaceId === where.workspaceId && a.userId === where.userId).map((a) => ({ branchId: a.branchId, role: a.role })),
  },
  branch: {
    findMany: async ({ where }: { where: { workspaceId: string } }) => branches.filter((b) => b.workspaceId === where.workspaceId).map((b) => ({ id: b.id })),
    findUnique: async ({ where }: { where: { id?: string; workspaceId_legacyKey?: { workspaceId: string; legacyKey: string } } }) => {
      if (where.id) return branches.find((b) => b.id === where.id) ?? null;
      const k = where.workspaceId_legacyKey!;
      return branches.find((b) => b.workspaceId === k.workspaceId && b.legacyKey === k.legacyKey) ?? null;
    },
  },
};

(async () => {
  const A = await import("../lib/authz");
  const { decideCapability, PRESET_CAPABILITIES, CAPABILITIES } = A;
  type Cap = (typeof CAPABILITIES)[number];
  const inputs = (role: string | null, rows: { branchId: string; role: string }[] = [], status = "ACTIVE", ws: string | null = WS) => ({
    workspaceId: ws,
    membership: role ? { role, status } : null,
    assignments: rows,
    canonicalLegacyBranchId: ws === WS ? CANON : ws === WS_B ? CANON_B : null,
    workspaceBranchIds: branches.filter((b) => b.workspaceId === ws).map((b) => b.id),
  });
  const caps = (inp: ReturnType<typeof inputs>, branchIds: string[]) =>
    CAPABILITIES.filter((c) => decideCapability(inp, c as Cap, branchIds).decision === "ALLOW").sort().join(",");

  // ── presets ────────────────────────────────────────────────────────────────────────────────────────────────
  const all = [...CAPABILITIES].sort().join(",");
  assert("WORKSPACE_ADMIN = ADMIN: all capabilities (incl. users.manage / master.designate / branches.manage)", caps(inputs("WORKSPACE_ADMIN"), [CANON]) === all && caps(inputs("WORKSPACE_ADMIN"), []) === all);
  assert("SUPER_ADMIN membership = ADMIN", caps(inputs("SUPER_ADMIN"), [CANON]) === all);
  const hq = caps(inputs("MANAGER"), [CANON]);
  assert("MANAGER → HQ_CONTROL (not ADMIN)", decideCapability(inputs("MANAGER"), "playback.control", [CANON]).preset === "HQ_CONTROL" && hq !== all);
  assert("HQ_CONTROL = playback, announcement, schedule, monitoring, campaign, content",
    hq === ["announcement.send", "campaign.manage", "content.manage", "monitoring.view", "playback.control", "schedule.edit"].sort().join(","));
  assert("HQ_CONTROL: NO users.manage / master.designate / branches.manage",
    ["users.manage", "master.designate", "branches.manage"].every((c) => decideCapability(inputs("MANAGER"), c as Cap, []).decision === "DENY"));
  assert("HQ_CONTROL scope ALL covers every branch of its workspace", decideCapability(inputs("MANAGER"), "playback.control", [CANON, OTHER_BRANCH, "default"]).decision === "ALLOW");
  const bm = caps(inputs("CONTROLLER", [{ branchId: CANON, role: "BRANCH_MANAGER" }]), [CANON]);
  assert("BRANCH_MANAGER: exactly playback.control + announcement.send + monitoring.view", bm === "announcement.send,monitoring.view,playback.control");
  assert("BRANCH_CONTROLLER rows (all API-created) map to BRANCH_MANAGER defaults",
    caps(inputs("CONTROLLER", [{ branchId: CANON, role: "BRANCH_CONTROLLER" }]), [CANON]) === bm);
  assert("VIEW_ONLY: monitoring.view only", caps(inputs("CONTROLLER", [{ branchId: CANON, role: "VIEW_ONLY" }]), [CANON]) === "monitoring.view");
  assert("membership VIEWER → VIEW_ONLY regardless of assignment string", caps(inputs("VIEWER", [{ branchId: CANON, role: "BRANCH_CONTROLLER" }]), [CANON]) === "monitoring.view");
  assert("REGIONAL_MANAGER = operational set, no users/master/branches", caps(inputs("CONTROLLER", [{ branchId: CANON, role: "REGIONAL_MANAGER" }]), [CANON]) === hq);
  assert("content.manage: ADMIN / HQ / REGIONAL yes; BRANCH_MANAGER / VIEW_ONLY no",
    PRESET_CAPABILITIES.ADMIN.has("content.manage") && PRESET_CAPABILITIES.HQ_CONTROL.has("content.manage") && PRESET_CAPABILITIES.REGIONAL_MANAGER.has("content.manage") &&
    !PRESET_CAPABILITIES.BRANCH_MANAGER.has("content.manage") && !PRESET_CAPABILITIES.VIEW_ONLY.has("content.manage"));
  assert("content.manage is NOT folded into schedule.edit", CAPABILITIES.includes("content.manage") && CAPABILITIES.includes("schedule.edit"));

  // ── scope / branches ──────────────────────────────────────────────────────────────────────────────────────
  const bmIn = inputs("CONTROLLER", [{ branchId: "default", role: "BRANCH_CONTROLLER" }]);
  assert("legacy 'default' assignment covers canonical (same workspace)", decideCapability(bmIn, "playback.control", [CANON]).decision === "ALLOW");
  assert("canonical assignment covers 'default'", decideCapability(inputs("CONTROLLER", [{ branchId: CANON, role: "BRANCH_MANAGER" }]), "playback.control", ["default"]).decision === "ALLOW");
  const xb = decideCapability(bmIn, "playback.control", [OTHER_BRANCH]);
  assert("unrelated branch → DENY (branch-not-in-scope)", xb.decision === "DENY" && xb.reason === "branch-not-in-scope");
  const xw = decideCapability(bmIn, "playback.control", [CANON_B]);
  assert("other workspace's canonical is NOT equivalent → DENY", xw.decision === "DENY");
  const adminOtherWs = decideCapability(inputs("WORKSPACE_ADMIN"), "playback.control", [CANON_B]);
  assert("even ADMIN (ALL scope) is denied a branch of another workspace", adminOtherWs.decision === "DENY" && adminOtherWs.reason === "branch-not-in-workspace");
  assert("workspace-level action (no branch) needs ALL scope: branch user DENY",
    decideCapability(bmIn, "monitoring.view", []).decision === "DENY");
  assert("no assignment rows → implicit legacy default (today's behavior), canonical covered",
    decideCapability(inputs("CONTROLLER", []), "playback.control", [CANON]).decision === "ALLOW" &&
    decideCapability(inputs("CONTROLLER", []), "playback.control", [OTHER_BRANCH]).decision === "DENY");

  // ── fail closed ───────────────────────────────────────────────────────────────────────────────────────────
  const susp = decideCapability(inputs("WORKSPACE_ADMIN", [], "SUSPENDED"), "monitoring.view", [CANON]);
  assert("SUSPENDED membership → DENY", susp.decision === "DENY" && susp.reason === "membership-suspended");
  const nomem = decideCapability(inputs(null), "monitoring.view", [CANON]);
  assert("no membership in active workspace → DENY", nomem.decision === "DENY" && nomem.reason === "no-membership-in-active-workspace");
  assert("no active workspace → DENY", decideCapability(inputs("WORKSPACE_ADMIN", [], "ACTIVE", null), "monitoring.view", []).decision === "DENY");

  // ── ACTIVE session workspace wins (DB-backed path) ────────────────────────────────────────────────────────
  // User U is ADMIN in their PRIMARY workspace WS_B, but only a VIEWER in the ACTIVE workspace WS.
  members.push({ workspaceId: WS_B, userId: "U", role: "WORKSPACE_ADMIN", status: "ACTIVE" });
  members.push({ workspaceId: WS, userId: "U", role: "VIEWER", status: "ACTIVE" });
  assignments.push({ workspaceId: WS, userId: "U", branchId: "default", role: "BRANCH_CONTROLLER" });
  const active = await A.authorize({ userId: "U", workspaceId: WS }, "users.manage", []);
  assert("active workspace WS (VIEWER) is used — NOT primary WS_B (ADMIN)", active.decision === "DENY" && active.workspaceId === WS);
  assert("…and in WS the VIEWER gets monitoring.view only", (await A.authorize({ userId: "U", workspaceId: WS }, "monitoring.view", [CANON])).decision === "ALLOW" &&
    (await A.authorize({ userId: "U", workspaceId: WS }, "playback.control", [CANON])).decision === "DENY");
  assert("same user in WS_B context is ADMIN (resolution follows the given session workspace)", (await A.authorize({ userId: "U", workspaceId: WS_B }, "users.manage", [])).decision === "ALLOW");
  const stranger = await A.authorize({ userId: "U2", workspaceId: WS }, "playback.control", [CANON]);
  assert("user with no membership in the session workspace → DENY (no primary fallback)", stranger.decision === "DENY" && stranger.reason === "no-membership-in-active-workspace");

  // ── SHADOW never blocks ───────────────────────────────────────────────────────────────────────────────────
  assert("mode constant is SHADOW", A.AUTHZ_RUNTIME_MODE === "shadow" && /export const AUTHZ_RUNTIME_MODE: AuthzMode = "shadow";/.test(read("lib", "authz.ts")) && !/process\.env/.test(read("lib", "authz.ts")));
  const logs: string[] = [];
  const origLog = console.log;
  console.log = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  const t0 = Date.now();
  const ret = A.shadowAuthorize("test:site", { userId: "U", workspaceId: WS }, "users.manage", [null, CANON]);
  const sync = Date.now() - t0;
  (globalThis as unknown as { prisma: { workspaceMember: { findUnique: () => never } } }).prisma.workspaceMember.findUnique = () => { throw new Error("db down"); };
  let threw = false;
  try { A.shadowAuthorize("test:db-down", { userId: "U", workspaceId: WS }, "users.manage", []); } catch { threw = true; }
  await new Promise((r) => setTimeout(r, 50));
  console.log = origLog;
  assert("shadowAuthorize returns void synchronously (fire-and-forget, no await on request path)", ret === undefined && sync < 50);
  assert("shadowAuthorize never throws (DB error swallowed)", !threw);
  const line = logs.find((l) => l.includes('"site":"test:site"')) ?? "";
  assert("shadow log is structured: capability, decision, workspace, branches, preset, source", /^\[VONO authz\] shadow \{/.test(line) && /"capability":"users.manage"/.test(line) && /"decision":"DENY"/.test(line) && /"workspaceId":"31d30e23/.test(line) && /"branchIds":\["90d2b7b8/.test(line) && /"preset":"VIEW_ONLY"/.test(line) && /"source":"member:VIEWER/.test(line));
  assert("shadow log carries no user id / email / token", !/"userId"|@|token/i.test(line.replace("[VONO authz]", "")));

  // ── static: coverage + hooks never block ──────────────────────────────────────────────────────────────────
  const sites: [string, string][] = [
    ["app/api/playlists/play/[id]/route.ts", "playback.control"],
    ["app/api/schedules/route.ts", "schedule.edit"], ["app/api/schedules/[id]/route.ts", "schedule.edit"],
    ["app/api/admin/users/route.ts", "users.manage"], ["app/api/admin/users/pause-member/route.ts", "users.manage"],
    ["app/api/admin/users/resume-member/route.ts", "users.manage"], ["app/api/admin/users/remove-member/route.ts", "users.manage"],
    ["app/api/admin/branch-master/route.ts", "master.designate"], ["app/api/branches/route.ts", "branches.manage"],
    ["app/api/playlists/route.ts", "content.manage"], ["app/api/playlists/[id]/route.ts", "content.manage"],
    ["app/api/playlists/ai-build/route.ts", "content.manage"], ["app/api/sources/route.ts", "content.manage"],
    ["app/api/sources/[id]/route.ts", "content.manage"], ["app/api/sources/add-from-catalog-track/route.ts", "content.manage"],
    ["app/api/radio/route.ts", "content.manage"], ["app/api/radio/[id]/route.ts", "content.manage"],
    ["app/api/jingles/pads/route.ts", "content.manage"], ["app/api/jingles/library/route.ts", "content.manage"],
    ["app/api/jingles/generate/route.ts", "content.manage"],
  ];
  assert("shadow hooks present at every covered REST path", sites.every(([f, c]) => new RegExp(`shadowAuthorize\\("[^"]+", \\{ userId: [\\w.]+\\.id, workspaceId: [\\w.]+\\.tenantId \\}, "${c.replace(".", "\\.")}"`).test(read(...f.split("/")))));
  const tokenSites = ["app/api/auth/ws-token/route.ts", "app/api/auth/desktop/token/route.ts", "app/api/auth/desktop/token-from-session/route.ts"];
  assert("token mint shadow at all 3 mint routes (session workspace)", tokenSites.every((f) => /shadowTokenCapabilities\("[^"]+", \{ userId: user\.id, workspaceId: user\.tenantId \}, authorizedBranches\);/.test(read(...f.split("/")))));
  const allHookLines = [...sites.map(([f]) => f), ...tokenSites].flatMap((f) => read(...f.split("/")).split("\n").filter((l) => /shadow(Authorize|TokenCapabilities)\(/.test(l)));
  assert("no hook is awaited, returned or used in a condition on its result", allHookLines.length >= 25 && allHookLines.every((l) => !/await shadow|return shadow|= shadow|\(shadow/.test(l)));
  assert("WS server untouched by 3A", !/authz/.test(read("server", "index.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
