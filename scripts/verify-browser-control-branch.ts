/**
 * BROWSER CONTROL TARGET (owner 2026-10-13) — a manager's browser player controls the branch chosen in Control Room
 * (CONTROL in that branch room; the designated station stays MASTER). Behavioural tests with a fake window /
 * localStorage + static wiring guards (incl. the WS server rule that keeps a browser CONTROL).
 * Run: npx tsx scripts/verify-browser-control-branch.ts
 */
import { readFileSync } from "fs";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

const mem = new Map<string, string>();
const fakeWindow: Record<string, unknown> = {
  localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) },
};
(globalThis as unknown as { window: unknown }).window = fakeWindow;

async function main() {
  const cb = await import("../lib/control-branch");
  const sb = await import("../lib/station-branch");

  assert("B1 browser with no choice → legacy \"default\" (unchanged behaviour)", sb.stationBranchIdNow() === "default" && (await sb.resolveStationBranchId()) === "default");
  cb.setControlBranch({ branchId: "41f94e5e-2ba5-41f2-a6ad-eedd4b1ffbcb", label: "UNV-030 · Universe" });
  assert("B2 manager chose UNV-030 → the browser's sockets use that branch", sb.stationBranchIdNow() === "41f94e5e-2ba5-41f2-a6ad-eedd4b1ffbcb" && (await sb.resolveStationBranchId()) === "41f94e5e-2ba5-41f2-a6ad-eedd4b1ffbcb");
  assert("B3 label kept for the header indicator", cb.getControlBranch()?.label === "UNV-030 · Universe");
  mem.set(cb.CONTROL_BRANCH_KEY, JSON.stringify({ branchId: "../../evil room", label: "x" }));
  assert("B4 a malformed stored id is ignored → default", sb.stationBranchIdNow() === "default");
  mem.set(cb.CONTROL_BRANCH_KEY, "{not json");
  assert("B5 corrupt storage → default (never throws)", sb.stationBranchIdNow() === "default");
  cb.setControlBranch({ branchId: "abc-123", label: "y" });
  cb.clearControlBranch();
  assert("B6 clear → back to default", sb.stationBranchIdNow() === "default");

  // desktop app: MAIN's config wins, the browser choice is NEVER read
  cb.setControlBranch({ branchId: "41f94e5e-2ba5-41f2-a6ad-eedd4b1ffbcb", label: "z" });
  fakeWindow.syncbizDesktop = { getConfig: async () => ({ branchId: "90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2" }) };
  assert("B7 VONO desktop app: the stored browser choice is ignored (MAIN config branch)", (await sb.resolveStationBranchId()) === "90d2b7b8-7bce-4d5d-a984-5f84fa8ba0d2");
  delete fakeWindow.syncbizDesktop;

  const srv = read("server/index.ts");
  assert("W1 WS server: a REGISTER branch must be in the signed token's authorizedBranches",
    /if \(role !== "owner_global" && !isBranchAllowed\(branchId, authorizedBranches\)\) \{/.test(srv));
  assert("W2 WS server: in a designated branch every non-designated device is CONTROL (a browser can never be MASTER)",
    /permanent designation: not the designated station -> CONTROL/.test(srv));
  const ws = read("lib/remote-control/ws-client.ts");
  assert("W3 both browser sockets (device + controller) take the branch from useStationBranchId", (ws.match(/useStationBranchId\(\)/g) ?? []).length === 2);
  const panel = read("components/control-room/branch-panel.tsx");
  assert("W4 Control Room → Branch: the button stores the branch and reloads the player; hidden in the desktop app",
    /function ControlThisBranchButton/.test(panel) && /if \(isDesktopApp\) return null;/.test(panel) && /setControlBranch\(\{ branchId: target/.test(panel) && /window\.location\.assign\("\/sources"\)/.test(panel));
  const shell = read("components/app-shell.tsx");
  assert("W5 header: browser managers always see which branch they control (never a silent default)",
    /canManage && !isDesktopApp && !isManagementRoute \? \(\s*<Link\s+href="\/owner\/control-room"/.test(shell) && /t\("ctl\.controlling", \{ label: controlBranchLabel \?\? mgmt\(locale\)\.t\("ctl\.default"\) \}\)/.test(shell));
  assert("W6 a non-manager on the same browser never inherits a manager's branch choice", /if \(data\.accessType && data\.accessType !== "OWNER"\) clearControlBranch\(\);/.test(shell));
  console.log(`\n${pass} passed, ${fail} failed`);
}
void main();
