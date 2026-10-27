/**
 * Device enrollment — the pure rules (lib/device-enrollment.ts): off by default, the 7-day expiry, who may decide, the Player allocation, what a device is told, the
 * input checks. No database, no browser. Run: npx tsx scripts/verify-device-enrollment.ts
 */
import * as e from "../lib/device-enrollment";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const day = 86_400_000;
const t0 = new Date("2026-10-27T10:00:00Z");

// ── switched off by default ──
assert("E1 enrollment needs the env flag to be exactly 1 (unset / 0 / true are all off)", !e.isEnrollmentEnvEnabled({}) && !e.isEnrollmentEnvEnabled({ SYNCBIZ_DEVICE_ENROLLMENT: "0" }) && !e.isEnrollmentEnvEnabled({ SYNCBIZ_DEVICE_ENROLLMENT: "true" }) && e.isEnrollmentEnvEnabled({ SYNCBIZ_DEVICE_ENROLLMENT: "1" }));

// ── expiry ──
assert("E2 a request lives 7 days by default and the owner may set 1–30 (anything else is clamped)", e.DEFAULT_TTL_DAYS === 7 && e.clampTtlDays(0) === 1 && e.clampTtlDays(99) === 30 && e.clampTtlDays("x") === 7 && e.clampTtlDays(14) === 14 && e.computeExpiresAt(t0, 7).getTime() === t0.getTime() + 7 * day);
const pending = { status: "pending", expiresAt: new Date(t0.getTime() + day) };
assert("E3 a pending request past its expiry reads as expired, a decided one never does", e.effectiveStatus(pending, t0) === "pending" && e.effectiveStatus(pending, new Date(t0.getTime() + 2 * day)) === "expired" && e.effectiveStatus({ status: "approved", expiresAt: new Date(0) }, t0) === "approved" && e.effectiveStatus({ status: "revoked", expiresAt: new Date(0) }, t0) === "revoked");
assert("E4 an unknown status string is never treated as approved", e.effectiveStatus({ status: "banana", expiresAt: new Date(t0.getTime() + day) }, t0) !== "approved");

// ── roles per platform ──
assert("E5 a phone can only be a Remote; computers, the desktop app and the streamer may be players", !e.canRequestRole("ios", "PLAYER") && !e.canRequestRole("android", "PLAYER") && e.canRequestRole("ios", "REMOTE") && e.canRequestRole("browser", "PLAYER") && e.canRequestRole("desktop", "PLAYER") && e.canRequestRole("streamer", "PLAYER"));
assert("E6 a browser player is a 'browser' class, the desktop app a 'station'", e.playerClassFor("browser") === "browser" && e.playerClassFor("desktop") === "station" && e.playerClassFor("ios") === null);

// ── request input ──
const good = { durableDeviceId: "dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608", role: "REMOTE", platform: "browser", label: "  Dana's   PC\n(Chrome) ", note: "hi" };
const ok1 = e.validateRequestInput(good);
assert("E7 a good request is accepted and its text is cleaned (spaces and control characters)", ok1.ok && ok1.value.label === "Dana's PC (Chrome)" && ok1.value.branchId === null);
assert("E8 a player must name a branch; a remote may not", !e.validateRequestInput({ ...good, role: "PLAYER" }).ok && e.validateRequestInput({ ...good, role: "PLAYER", branchId: "b1" }).ok);
assert("E9 bad device ids, roles and platforms are refused", !e.validateRequestInput({ ...good, durableDeviceId: "x" }).ok && !e.validateRequestInput({ ...good, durableDeviceId: "has space in it 12345" }).ok && !e.validateRequestInput({ ...good, role: "MASTER" }).ok && !e.validateRequestInput({ ...good, platform: "toaster" }).ok && !e.validateRequestInput(null).ok && !e.validateRequestInput({ ...good, platform: "ios", role: "PLAYER", branchId: "b1" }).ok);
assert("E10 long labels and notes are cut (80 / 300)", (() => { const r = e.validateRequestInput({ ...good, label: "a".repeat(500), note: "b".repeat(900) }); return r.ok && r.value.label.length === 80 && r.value.note.length === 300; })());

// ── approval input ──
assert("E11 approving a player needs exactly one branch; a remote may have several or none", !e.validateApproveInput({ role: "PLAYER", branchIds: [] }).ok && !e.validateApproveInput({ role: "PLAYER", branchIds: ["a", "b"] }).ok && e.validateApproveInput({ role: "PLAYER", branchIds: ["a"] }).ok && e.validateApproveInput({ role: "REMOTE", branchIds: ["a", "b", "a"] }).ok);
assert("E12 'replace' must be asked for explicitly — the default is a standby, never a silent replacement", (() => { const d = e.validateApproveInput({ role: "PLAYER", branchIds: ["a"] }); const r = e.validateApproveInput({ role: "PLAYER", branchIds: ["a"], mode: "replace" }); return d.ok && d.value.mode === "standby" && r.ok && r.value.mode === "replace"; })());

// ── who may decide ──
const admin: e.Actor = { userId: "u1", isAdmin: true, isManager: false, branchIds: [] };
const mgr: e.Actor = { userId: "u2", isAdmin: false, isManager: true, branchIds: ["b1", "b2"] };
const staff: e.Actor = { userId: "u3", isAdmin: false, isManager: false, branchIds: ["b1"] };
assert("E13 an admin decides everything, including a device with no branch", e.actorCanDecide(admin, ["zz"]) && e.actorCanDecide(admin, []));
assert("E14 a branch manager decides only inside their own branches — all of them", e.actorCanDecide(mgr, ["b1"]) && e.actorCanDecide(mgr, ["b1", "b2"]) && !e.actorCanDecide(mgr, ["b3"]) && !e.actorCanDecide(mgr, ["b1", "b3"]));
assert("E15 a manager can never decide a device that has no branch (that is the admin's)", !e.actorCanDecide(mgr, []));
assert("E16 anyone below manager decides nothing, even in their own branch", !e.actorCanDecide(staff, ["b1"]));
assert("E17 the branches of a row: the approved scope once decided, otherwise the requested branch", JSON.stringify(e.rowBranchIds({ approvedBranchIds: ["a"], requestedBranchId: "b" })) === '["a"]' && JSON.stringify(e.rowBranchIds({ approvedBranchIds: [], requestedBranchId: "b" })) === '["b"]' && e.rowBranchIds({ approvedBranchIds: [], requestedBranchId: null }).length === 0);

// ── allocation ──
const a12 = e.allocationState(20, 12);
assert("E18 the allocation counts players: 12 of 20 leaves 8", a12.used === 12 && a12.max === 20 && a12.remaining === 8 && !a12.full);
const full = e.allocationState(20, 20);
assert("E19 when it is full, one more player is refused — but a device that already counts keeps its seat", full.full && !e.canApproveAnotherPlayer(full, false) && e.canApproveAnotherPlayer(full, true) && e.canApproveAnotherPlayer(a12, false));
assert("E20 an over-full allocation (running stations that were already there) never goes negative", (() => { const o = e.allocationState(1, 3); return o.used === 3 && o.remaining === 0 && o.full; })());

// ── what the device is told ──
const row = (over: Partial<Parameters<typeof e.toPublicStatus>[0] & object> = {}) => ({ status: "pending", expiresAt: new Date(t0.getTime() + day), requestedAt: t0, approvedRole: null, playerClass: null, approvedBranchIds: [] as string[], decisionNote: "", ...over });
assert("E21 no row = unknown (the device is asked to request)", (() => { const s = e.toPublicStatus(null, t0); return s.enforced && s.status === "unknown"; })());
assert("E22 pending / expired / rejected / revoked carry only the status and times — never the branch list", (() => { const s = e.toPublicStatus(row({ status: "rejected", decisionNote: "not this one" }), t0); return s.enforced && s.status === "rejected" && !("branchIds" in s) && "decisionNote" in s; })());
assert("E23 an approved row tells its role, class and branches", (() => { const s = e.toPublicStatus(row({ status: "approved", approvedRole: "PLAYER", playerClass: "browser", approvedBranchIds: ["b1"] }), t0); return s.enforced && s.status === "approved" && s.role === "PLAYER" && s.playerClass === "browser" && s.branchIds[0] === "b1"; })());
assert("E24 an 'approved' row with no valid role is never reported as approved", (() => { const s = e.toPublicStatus(row({ status: "approved", approvedRole: null }), t0); return s.enforced && s.status === "unknown"; })());
assert("E25 the token claim exists only for an approved, valid role (never for pending, revoked or expired)", e.enrollmentClaimFor(row({ status: "approved", approvedRole: "REMOTE" }), t0) === "REMOTE" && e.enrollmentClaimFor(row({ status: "pending" }), t0) === null && e.enrollmentClaimFor(row({ status: "revoked", approvedRole: "PLAYER" }), t0) === null && e.enrollmentClaimFor(null, t0) === null && e.enrollmentClaimFor(row({ status: "approved", approvedRole: "ADMIN" }), t0) === null);

// ── the token gate ──
const approvedRow = (over: Record<string, unknown> = {}) => ({ status: "approved", expiresAt: new Date(t0.getTime() + day), requestedAt: t0, approvedRole: "REMOTE", playerClass: null, approvedBranchIds: [] as string[], decisionNote: "", ...over });
const devId = "dsk-9b11bfa1-a353-4abb-859c-2351cf1d0608";
const mint = (over: Partial<Parameters<typeof e.decideMint>[0]> = {}) => e.decideMint({ enabled: true, userAgent: "Mozilla/5.0 Chrome/130", durableDeviceId: devId, row: approvedRow(), now: t0, ...over });
assert("E26 with enrollment off, the token route behaves exactly as before", mint({ enabled: false }).kind === "off" && mint({ enabled: false, durableDeviceId: null, row: null }).kind === "off");
assert("E27 an unknown device, or one that sends no id, gets NO token", (() => { const a = mint({ row: null }); const b = mint({ durableDeviceId: null }); const c = mint({ durableDeviceId: "x" }); return a.kind === "blocked" && b.kind === "blocked" && c.kind === "blocked"; })());
assert("E28 pending, rejected, revoked and expired devices get NO token — and are told which", (["pending", "rejected", "revoked"] as const).every((st) => { const d = mint({ row: approvedRow({ status: st, approvedRole: null }) }); return d.kind === "blocked" && d.status === st; }) && (() => { const d = mint({ row: approvedRow({ status: "pending", expiresAt: new Date(t0.getTime() - 1) }) }); return d.kind === "blocked" && d.status === "expired"; })());
assert("E29 an approved device gets its role; a Player gets exactly its branch", (() => { const d = mint({ row: approvedRow({ approvedRole: "PLAYER", approvedBranchIds: ["b1"] }) }); return d.kind === "approved" && d.role === "PLAYER" && d.branchIds[0] === "b1"; })());
assert("E30 an 'approved' row with no valid role gets no token", mint({ row: approvedRow({ approvedRole: null }) }).kind === "blocked");
assert("E31 the desktop app's own screen is not gated by this door (stations use the activation code); a plain browser is", mint({ userAgent: "Mozilla/5.0 (Windows) VONO/2.2.8 Chrome/130 Electron/33.0.0 Safari/537.36", row: null }).kind === "exempt" && mint({ row: null }).kind === "blocked");
assert("E32 the token's branches are narrowed to what the manager approved; an empty approval narrows nothing; nothing outside the user's own rights is ever added", JSON.stringify(e.restrictBranches(["a", "b", "default"], ["b"])) === '["b"]' && JSON.stringify(e.restrictBranches(["a", "b"], [])) === '["a","b"]' && e.restrictBranches(["a"], ["zzz"]).length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
