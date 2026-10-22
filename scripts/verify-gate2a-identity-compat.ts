/**
 * CONTROL ROOM GATE 2A-1 — identity / authorization compatibility (NO routing, NO data, NO content change).
 *  - legacy "default" ≡ the workspace's canonical branch ONLY within that workspace's alias mapping
 *  - station register/bind: no branch_conflict across the alias, stored row never moved; real conflicts remain
 *  - desktop token carries signed stationBranchId (canonical form of the STORED binding), only with stationDeviceId
 *  - the current WS verifier tolerates the new claim (WS server unchanged in 2A-1)
 *  - content resolver + WS alias stay SHADOW (no content normalization, no room change)
 * Run: npx tsx scripts/verify-gate2a-identity-compat.ts
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { legacyBranchEquivalent, legacyBranchEquivalents, canonicalizeLegacyBranch } from "../lib/branch-resolver";
import { registerStationDevice, DurableDeviceConflictError, type StationDeviceRepo } from "../lib/station-device-store";
import { buildDesktopAuthClaims } from "../lib/station-device-bind";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (...p: string[]) => readFileSync(path.join(__dirname, "..", ...p), "utf-8").replace(/\r\n/g, "\n");
const WS = "31d30e23-8f4a-4bf2-a1df-c707b69b5673";
const CANON = "90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2";
const OTHER_WS_CANON = "aaaaaaaa-0000-4000-8000-000000000000";
const LENOVO = "dsk-cbeb93d0-0023-47e0-aebc-b07fe350415f";

(async () => {
  // ── pure equivalence ──────────────────────────────────────────────────────────────────────────────────────
  assert("default ≡ canonical (this workspace)", legacyBranchEquivalent("default", CANON, CANON) && legacyBranchEquivalent(CANON, "default", CANON));
  assert("empty ≡ default ≡ canonical", legacyBranchEquivalent("", CANON, CANON));
  assert("no canonical → only strict equality", !legacyBranchEquivalent("default", CANON, null) && legacyBranchEquivalent("default", "default", null));
  assert("cannot reach ANOTHER workspace's canonical", !legacyBranchEquivalent("default", OTHER_WS_CANON, CANON));
  assert("two different real branches never equivalent", !legacyBranchEquivalent(CANON, "b-2", CANON) && !legacyBranchEquivalent("b-2", "default", CANON));
  assert("equivalents / canonicalize", JSON.stringify(legacyBranchEquivalents("default", CANON)) === JSON.stringify(["default", CANON]) &&
    JSON.stringify(legacyBranchEquivalents("b-2", CANON)) === JSON.stringify(["b-2"]) &&
    canonicalizeLegacyBranch("default", CANON) === CANON && canonicalizeLegacyBranch("default", null) === "default" && canonicalizeLegacyBranch("b-2", CANON) === "b-2");

  // ── station register (in-memory repo) ─────────────────────────────────────────────────────────────────────
  function repo(stored: { workspaceId: string; branchId: string } | null) {
    const rows = new Map<string, { workspaceId: string; branchId: string; platform: string; appVersion: string }>();
    if (stored) rows.set(LENOVO, { ...stored, platform: "win", appVersion: "old" });
    const r: StationDeviceRepo & { rows: typeof rows; refreshedMatch: { workspaceId: string; branchId: string } | null } = {
      rows, refreshedMatch: null,
      async create(i) { if (rows.has(i.durableDeviceId)) throw new DurableDeviceConflictError(); rows.set(i.durableDeviceId, { workspaceId: i.workspaceId, branchId: i.branchId, platform: i.platform, appVersion: i.appVersion }); },
      async findByDurableId(id) { const x = rows.get(id); return x ? { workspaceId: x.workspaceId, branchId: x.branchId } : null; },
      async refresh(id, match, patch) { r.refreshedMatch = match; const x = rows.get(id); if (x && x.workspaceId === match.workspaceId && x.branchId === match.branchId) { x.platform = patch.platform; x.appVersion = patch.appVersion; } },
    };
    return r;
  }
  const alias = { isSameBranch: (s: string, q: string) => legacyBranchEquivalent(s, q, CANON) };
  const input = (branchId: string) => ({ durableDeviceId: LENOVO, workspaceId: WS, branchId, platform: "win", appVersion: "2.2.8-beta.10" });
  {
    const r = repo({ workspaceId: WS, branchId: "default" });
    const res = await registerStationDevice(r, input("default"), alias);
    assert("pre-migration: row 'default', request 'default' → refreshed (unchanged behavior)", res.outcome === "refreshed" && res.boundBranchId === "default");
  }
  {
    const r = repo({ workspaceId: WS, branchId: CANON });
    const res = await registerStationDevice(r, input("default"), alias);
    assert("post-migration: row canonical, beta.10 request 'default' → refreshed, NOT branch_conflict", res.outcome === "refreshed" && res.boundBranchId === CANON);
    assert("…stored row NOT moved, refresh guarded on the STORED branch", r.rows.get(LENOVO)!.branchId === CANON && r.refreshedMatch?.branchId === CANON && r.rows.get(LENOVO)!.appVersion === "2.2.8-beta.10");
  }
  {
    const r = repo({ workspaceId: WS, branchId: "default" });
    const res = await registerStationDevice(r, input(CANON), alias);
    assert("row 'default', request canonical → refreshed (bound stays 'default')", res.outcome === "refreshed" && res.boundBranchId === "default" && r.rows.get(LENOVO)!.branchId === "default");
  }
  {
    const r = repo({ workspaceId: WS, branchId: "b-2" });
    assert("real different branch still → branch_conflict (no auto-move)", (await registerStationDevice(r, input("default"), alias)).outcome === "branch_conflict" && r.rows.get(LENOVO)!.branchId === "b-2");
  }
  {
    const r = repo({ workspaceId: "ws-other", branchId: "default" });
    assert("other workspace still → workspace_conflict", (await registerStationDevice(r, input("default"), alias)).outcome === "workspace_conflict");
  }
  {
    const r = repo({ workspaceId: WS, branchId: CANON });
    assert("strict default (no options) unchanged → alias is a conflict", (await registerStationDevice(r, input("default"))).outcome === "branch_conflict");
  }
  {
    const r = repo(null);
    const res = await registerStationDevice(r, input("default"), alias);
    assert("first registration → created, bound = requested", res.outcome === "created" && res.boundBranchId === "default");
  }

  // ── desktop claims (bind) ─────────────────────────────────────────────────────────────────────────────────
  const canonicalizeBranch = async (_ws: string, b: string) => canonicalizeLegacyBranch(b, CANON);
  const base = { workspaceId: WS, authorizedBranches: [CANON, "default"], deviceId: LENOVO, branchId: "default", platform: "win", appVersion: "x" };
  {
    const c = await buildDesktopAuthClaims(base, {
      register: async () => ({ outcome: "refreshed", boundBranchId: CANON }),
      getDesignatedMasters: async () => ({ [CANON]: LENOVO }), canonicalizeBranch,
    });
    assert("bind (post-migration): stationDeviceId preserved + stationBranchId = canonical", c.stationDeviceId === LENOVO && c.stationBranchId === CANON);
  }
  {
    const c = await buildDesktopAuthClaims(base, {
      register: async () => ({ outcome: "refreshed", boundBranchId: "default" }),
      getDesignatedMasters: async () => ({ default: LENOVO }), canonicalizeBranch,
    });
    assert("bind (pre-migration, 2A-1): stationDeviceId preserved + stationBranchId canonicalized", c.stationDeviceId === LENOVO && c.stationBranchId === CANON);
  }
  {
    const c = await buildDesktopAuthClaims(base, {
      register: async () => ({ outcome: "branch_conflict" }),
      getDesignatedMasters: async () => ({}), canonicalizeBranch,
    });
    assert("bind conflict → NO stationDeviceId and NO stationBranchId", c.stationDeviceId === undefined && c.stationBranchId === undefined);
  }
  {
    const c = await buildDesktopAuthClaims({ ...base, branchId: "evil-branch" }, {
      register: async () => ({ outcome: "refreshed", boundBranchId: "x" }),
      getDesignatedMasters: async () => ({}), canonicalizeBranch,
    });
    assert("client cannot pick a branch outside authorizedBranches (no bind, no claim)", c.stationDeviceId === undefined && c.stationBranchId === undefined);
  }

  // ── token round-trip through the REAL (unchanged) WS verifier ─────────────────────────────────────────────
  process.env.SYNCBIZ_WS_SECRET = "test-secret-not-real-0123456789";
  const { createDesktopAccessToken } = await import("../lib/auth-ws-token");
  const { verifyWsToken } = await import("../server/ws-token");
  const tok = createDesktopAccessToken("user-1", { workspaceId: WS, authorizedBranches: [CANON, "default"], stationDeviceId: LENOVO, stationBranchId: CANON, designatedMasterByBranch: { default: LENOVO } });
  const payload = JSON.parse(Buffer.from(tok.split(".")[0], "base64url").toString("utf-8"));
  assert("desktop token carries signed stationBranchId", payload.stationBranchId === CANON && payload.stationDeviceId === LENOVO);
  const v = verifyWsToken(tok);
  assert("current WS verifier accepts the token unchanged (stationDeviceId, workspace, branches intact)",
    !!v && v.stationDeviceId === LENOVO && v.workspaceId === WS && Array.isArray(v.authorizedBranches) && v.authorizedBranches!.includes("default"));
  const tokNoStation = createDesktopAccessToken("user-1", { workspaceId: WS, stationBranchId: CANON });
  assert("stationBranchId is never emitted without stationDeviceId",
    JSON.parse(Buffer.from(tokNoStation.split(".")[0], "base64url").toString("utf-8")).stationBranchId === undefined);

  // ── scope guards (static) ─────────────────────────────────────────────────────────────────────────────────
  const res = read("lib", "branch-resolver.ts");
  assert("content resolver still SHADOW (no content normalization in 2A)", /export const BRANCH_RESOLUTION_RUNTIME_MODE: BranchResolutionMode = "shadow";/.test(res));
  // Gate 2A-3 (documented change): WS alias is ACTIVE; stationBranchId is read for evidence logging only, never routing.
  assert("WS alias ACTIVE since Gate 2A-3", /export const BRANCH_ALIAS_RUNTIME_MODE: BranchAliasMode = "active";/.test(read("server", "branch-alias.ts")));
  const idx = read("server", "index.ts");
  assert("WS uses stationBranchId only in the alias log hook (not for routing)",
    !/(const roomKey = |expectedRoomKey = |const effectiveBranchId = )[^\n]*stationBranchId/.test(idx) && (idx.match(/stationBranchId: auth\.stationBranchId/g) ?? []).length === 1);
  const contentRoutes = ["app/api/jingles/pads/route.ts", "app/api/jingles/library/route.ts", "app/api/playlists/route.ts", "app/api/radio/route.ts"];
  // Gate 2B-1 (documented change): content routes may import ONLY the 2B-1 content-compat helpers from the resolver
  // (no shadow/resolution-mode switch); playlists/radio routes stay resolver-free (their stores canonicalize).
  assert("content routes use only the 2B-1 content-compat resolver helpers", contentRoutes.every((p) => {
    const src = read(...p.split("/"));
    const m = src.match(/import \{([^}]*)\} from "@\/lib\/branch-resolver";/);
    if (!m) return !/branch-resolver/.test(src);
    return m[1].split(",").map((s) => s.trim()).filter(Boolean).every((n) => ["canonicalContentBranchForWrite", "expandLegacyBranchEquivalents"].includes(n));
  }) && !/branch-resolver/.test(read("app", "api", "playlists", "route.ts")) && !/branch-resolver/.test(read("app", "api", "radio", "route.ts")));

  console.log(`\n${pass} passed, ${fail} failed`);
})();
