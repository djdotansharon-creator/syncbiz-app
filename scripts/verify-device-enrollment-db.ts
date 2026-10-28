/**
 * Device enrollment against a REAL (local) database — the store (lib/device-enrollment-store.ts) end to end: switched off, switched on with grandfathering, request → approve / reject /
 * revoke, the Player allocation, the 7-day expiry, who may decide (admin / branch manager), the request cap, the audit log. It builds a throwaway workspace and removes it again.
 * REFUSES to run against anything but a localhost database.
 *
 * Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-device-enrollment-db.ts
 */
import { randomUUID } from "node:crypto";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("REFUSED: DATABASE_URL is not a localhost database — this test creates and deletes rows.");
  process.exit(2);
}

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const day = 86_400_000;

async function main() {
  const { prisma } = await import("../lib/prisma");
  const store = await import("../lib/device-enrollment-store");
  const rules = await import("../lib/device-enrollment");
  const tag = randomUUID().slice(0, 8);
  const mk = (n: string) => `${n}-${tag}-${randomUUID().slice(0, 8)}`;
  const throws = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return "";
    } catch (e) {
      return e instanceof store.EnrollmentError ? e.code : `other:${e instanceof Error ? e.message : String(e)}`;
    }
  };

  // ── fixture: a workspace with two branches, two stations, an admin, a manager of branch 1 ──
  const owner = await prisma.user.create({ data: { email: `enroll-owner-${tag}@example.test`, role: "WORKSPACE_ADMIN" } });
  const ws = await prisma.workspace.create({ data: { name: `Enroll test ${tag}`, slug: `enroll-test-${tag}`, ownerId: owner.id } });
  const b1 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Branch One" } });
  const b2 = await prisma.branch.create({ data: { workspaceId: ws.id, name: "Branch Two" } });
  const st1 = mk("dsk-station1");
  const st2 = mk("dsk-station2");
  await prisma.stationDevice.createMany({ data: [{ durableDeviceId: st1, workspaceId: ws.id, branchId: b1.id, platform: "windows", appVersion: "2.2.8" }, { durableDeviceId: st2, workspaceId: ws.id, branchId: b2.id, platform: "windows", appVersion: "2.2.8" }] });
  // the audit log references real users, so the people in this test are real rows too
  const mgrUser = await prisma.user.create({ data: { email: `enroll-mgr-${tag}@example.test`, role: "MANAGER" } });
  const staffUser = await prisma.user.create({ data: { email: `enroll-staff-${tag}@example.test`, role: "CONTROLLER" } });
  const spamUser = await prisma.user.create({ data: { email: `enroll-spam-${tag}@example.test`, role: "CONTROLLER" } });
  const admin = { userId: owner.id, isAdmin: true, isManager: false, branchIds: [] as string[] };
  const mgr1 = { userId: mgrUser.id, isAdmin: false, isManager: true, branchIds: [b1.id] };
  const staff = { userId: staffUser.id, isAdmin: false, isManager: false, branchIds: [b1.id] };
  const devices = { dana: mk("web-dana"), yossi: mk("ios-yossi"), shop: mk("web-shop"), extra: mk("web-extra"), admin: mk("web-admin") };
  const input = (id: string, role: "PLAYER" | "REMOTE", platform: "browser" | "ios", branchId: string | null = null, branchName = "") => ({
    durableDeviceId: id, role, platform, branchId, branchName, branchAddress: "", brandName: "", firstName: "Dana", lastName: "Cohen", phone: "050-1234567", email: "dana@example.test", label: id, note: "", appVersion: "",
  });

  try {
    // ── off ──
    delete process.env.SYNCBIZ_DEVICE_ENROLLMENT;
    assert("D1 with the env flag off, enrollment is off and nothing is read", (await store.getEnrollmentConfig(ws.id)).enabled === false && (await throws(() => store.enableEnrollment({ workspaceId: ws.id, actorUserId: owner.id }))) === "enrollment_not_available");
    process.env.SYNCBIZ_DEVICE_ENROLLMENT = "1";
    assert("D2 with the env flag on but the workspace not switched on, it is still off (and a request is refused)", (await store.getEnrollmentConfig(ws.id)).enabled === false && (await throws(() => store.submitRequest({ workspaceId: ws.id, userId: owner.id, input: input(devices.dana, "REMOTE", "browser"), ip: "", userAgent: "" }))) === "enrollment_disabled");

    // ── switching on: nothing running goes dark ──
    const on = await store.enableEnrollment({ workspaceId: ws.id, actorUserId: owner.id, ownDeviceId: devices.admin, ownDeviceLabel: "Admin's Mac" });
    const cfg = await store.getEnrollmentConfig(ws.id);
    assert("D3 switching it on approves every existing station and the admin's own device (grandfathered), 7-day expiry by default", on.grandfatheredStations === 2 && cfg.enabled && cfg.ttlDays === 7);
    const list0 = await store.listEnrollments({ workspaceId: ws.id, actor: admin });
    assert("D4 the list shows 3 approved devices; 2 players are counted (the owner's own computer is not)", list0.items.length === 3 && list0.items.every((i) => i.status === "approved" && i.grandfathered) && list0.allocation.used === 2);
    assert("D5 switching it on twice changes nothing (idempotent)", (await store.enableEnrollment({ workspaceId: ws.id, actorUserId: owner.id, ownDeviceId: devices.admin })).grandfatheredStations === 0 && (await store.listEnrollments({ workspaceId: ws.id, actor: admin })).items.length === 3);
    // the admin's own device, if it had been revoked, comes back when enrollment is switched on again (the admin is never locked out)
    await prisma.deviceEnrollment.updateMany({ where: { workspaceId: ws.id, durableDeviceId: devices.admin }, data: { status: "revoked", approvedRole: null } });
    await store.enableEnrollment({ workspaceId: ws.id, actorUserId: owner.id, ownDeviceId: devices.admin });
    assert("D5b a revoked admin device is approved again, as the owner\'s computer, when enrollment is switched on (no lock-out)", (await store.getEnrollmentByDevice(ws.id, devices.admin))?.status === "approved" && (await store.getEnrollmentByDevice(ws.id, devices.admin))?.approvedRole === "PLAYER" && (await store.getEnrollmentByDevice(ws.id, devices.admin))?.playerClass === "owner");
    await store.setMaxPlayers({ workspaceId: ws.id, actorUserId: owner.id, maxPlayers: 3 });

    // ── a remote asks, a manager decides ──
    const t0 = new Date();
    const r1 = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: input(devices.yossi, "REMOTE", "ios", b1.id), ip: "1.2.3.4", userAgent: "UA", now: t0 });
    assert("D6 a request is pending and expires in 7 days", r1.status === "pending" && Math.round((r1.expiresAt.getTime() - t0.getTime()) / day) === 7);
    const r1b = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: { ...input(devices.yossi, "REMOTE", "ios", b1.id), label: "Yossi's iPhone" }, ip: "", userAgent: "", now: new Date(t0.getTime() + 1000) });
    assert("D7 asking again refreshes the same request and does NOT extend its expiry", r1b.id === r1.id && r1b.label === "Yossi's iPhone" && r1b.expiresAt.getTime() === r1.expiresAt.getTime());
    assert("D8 a manager of ANOTHER branch cannot decide it, nor can staff", (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: { ...mgr1, branchIds: [b2.id] }, id: r1.id, input: { role: "REMOTE", branchIds: [b1.id], mode: "standby", note: "" } }))) === "forbidden" && (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: staff, id: r1.id, input: { role: "REMOTE", branchIds: [b1.id], mode: "standby", note: "" } }))) === "forbidden");
    assert("D9 a branch manager cannot grant a scope outside their own branches, nor an empty (account-wide) one", (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: mgr1, id: r1.id, input: { role: "REMOTE", branchIds: [b1.id, b2.id], mode: "standby", note: "" } }))) === "forbidden" && (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: mgr1, id: r1.id, input: { role: "REMOTE", branchIds: [], mode: "standby", note: "" } }))) === "forbidden");
    assert("D10 the manager of that branch sees the request and approves it as a Remote of their branch", (await store.listEnrollments({ workspaceId: ws.id, actor: mgr1 })).items.some((i) => i.id === r1.id && i.canDecide) && (await store.approveEnrollment({ workspaceId: ws.id, actor: mgr1, id: r1.id, input: { role: "REMOTE", branchIds: [b1.id], mode: "standby", note: "ok" } })).status === "approved");
    assert("D11 the manager of branch 1 does not even SEE a request about branch 2", await (async () => {
      await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: input(devices.extra, "REMOTE", "browser", b2.id), ip: "", userAgent: "" });
      return !(await store.listEnrollments({ workspaceId: ws.id, actor: mgr1 })).items.some((i) => i.requestedBranchId === b2.id);
    })());
    const st = rules.toPublicStatus(await store.getEnrollmentByDevice(ws.id, devices.yossi), new Date());
    assert("D12 the approved device is told: approved, Remote, its branch", st.enforced && st.status === "approved" && st.role === "REMOTE" && st.branchIds[0] === b1.id);

    // ── the Player allocation ──
    const p1 = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: input(devices.dana, "PLAYER", "browser", b1.id), ip: "", userAgent: "" });
    const approvedP = await store.approveEnrollment({ workspaceId: ws.id, actor: mgr1, id: p1.id, input: { role: "PLAYER", branchIds: [b1.id], mode: "standby", note: "" } });
    assert("D13 a browser can be approved as a Player (class browser); the allocation is now 3 of 3", approvedP.approvedRole === "PLAYER" && approvedP.playerClass === "browser" && (await store.getAllocation(ws.id)).used === 3);
    const p2 = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: input(devices.shop, "PLAYER", "browser", b1.id), ip: "", userAgent: "" });
    assert("D14 one more Player is refused when the allocation is full", (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: admin, id: p2.id, input: { role: "PLAYER", branchIds: [b1.id], mode: "standby", note: "" } }))) === "allocation_full");
    assert("D15 …but the same request approved as a REMOTE needs no seat", (await store.approveEnrollment({ workspaceId: ws.id, actor: admin, id: p2.id, input: { role: "REMOTE", branchIds: [b1.id], mode: "standby", note: "" } })).approvedRole === "REMOTE");
    assert("D16 'replace the current player' is not available through enrollment yet (never a silent replacement)", (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: admin, id: p2.id, input: { role: "PLAYER", branchIds: [b1.id], mode: "replace", note: "" } }))) === "replace_not_available_yet");

    // ── reject / revoke / re-request ──
    const rj = await store.rejectEnrollment({ workspaceId: ws.id, actor: admin, id: (await store.getEnrollmentByDevice(ws.id, devices.extra))!.id, note: "not this one" });
    assert("D17 a pending request can be rejected, with a note the device can read", rj.status === "rejected" && (() => { const s = rules.toPublicStatus(rj, new Date()); return s.enforced && s.status === "rejected" && s.decisionNote === "not this one"; })());
    const rv = await store.revokeEnrollment({ workspaceId: ws.id, actor: mgr1, id: r1.id, note: "left the company" });
    assert("D18 an approved device can be revoked by the manager of its branch — it then has no claim", rv.status === "revoked" && rules.enrollmentClaimFor(rv, new Date()) === null);
    assert("D19 a device can ask again after a revoke / reject and becomes a fresh pending request", (await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: input(devices.yossi, "REMOTE", "ios", b1.id), ip: "", userAgent: "" })).status === "pending");
    assert("D20 only a pending request can be approved or rejected, only an approved one revoked", (await throws(() => store.rejectEnrollment({ workspaceId: ws.id, actor: admin, id: rj.id, note: "" }))) === "not_pending" && (await throws(() => store.revokeEnrollment({ workspaceId: ws.id, actor: admin, id: rj.id, note: "" }))) === "not_approved");

    // ── expiry ──
    const old = new Date(Date.now() - 8 * day);
    await prisma.deviceEnrollment.deleteMany({ where: { workspaceId: ws.id, durableDeviceId: devices.extra } });
    const ex = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: input(devices.extra, "REMOTE", "browser", b2.id), ip: "", userAgent: "", now: old });
    assert("D21 a request older than 7 days reads as expired and can no longer be approved", rules.effectiveStatus(ex, new Date()) === "expired" && (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: admin, id: ex.id, input: { role: "REMOTE", branchIds: [b2.id], mode: "standby", note: "" } }))) === "not_pending" && (await store.listEnrollments({ workspaceId: ws.id, actor: admin })).items.find((i) => i.id === ex.id)?.status === "expired");

    // ── guards ──
    assert("D22 a request naming a branch that is not in the workspace is refused", (await throws(() => store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: input(mk("web-ghost"), "REMOTE", "browser", randomUUID()), ip: "", userAgent: "" }))) === "branch_not_found");
    const ws2 = await prisma.workspace.create({ data: { name: `Enroll test2 ${tag}`, slug: `enroll-test2-${tag}`, ownerId: owner.id } });
    try {
      await store.enableEnrollment({ workspaceId: ws2.id, actorUserId: owner.id });
      assert("D23 another workspace (even with enrollment on) cannot see or decide this workspace's request — it is simply not found", (await throws(() => store.approveEnrollment({ workspaceId: ws2.id, actor: admin, id: p2.id, input: { role: "REMOTE", branchIds: [], mode: "standby", note: "" } }))) === "not_found" && (await store.listEnrollments({ workspaceId: ws2.id, actor: admin })).items.length === 0);
    } finally {
      await prisma.auditLog.deleteMany({ where: { workspaceId: ws2.id } });
      await prisma.workspace.delete({ where: { id: ws2.id } }).catch(() => undefined);
    }
    // ── the owner's own computer: the normal interface, able to play, and a gift — never a Player seat (owner 2026-10-28) ──
    const ws3 = await prisma.workspace.create({ data: { name: `Enroll test3 ${tag}`, slug: `enroll-test3-${tag}`, ownerId: owner.id } });
    try {
      const own3 = mk("web-admin3");
      await store.enableEnrollment({ workspaceId: ws3.id, actorUserId: owner.id, ownDeviceId: own3 });
      const r3 = await store.getEnrollmentByDevice(ws3.id, own3);
      assert("D35 the admin's own computer at switch-on becomes the owner's computer: a PLAYER of class owner (it plays as usual), not narrowed to a branch, and it takes NO seat", r3?.approvedRole === "PLAYER" && r3?.playerClass === "owner" && r3?.approvedBranchIds.length === 0 && r3?.grandfathered === true && (await store.getAllocation(ws3.id)).used === 0);
      const own3b = mk("web-admin3b");
      await store.enableEnrollment({ workspaceId: ws3.id, actorUserId: owner.id, ownDeviceId: own3b });
      const player3 = await store.submitRequest({ workspaceId: ws3.id, userId: staff.userId, input: input(mk("web-seat3"), "PLAYER", "browser", "default"), ip: "", userAgent: "" });
      const approved3 = await store.approveEnrollment({ workspaceId: ws3.id, actor: admin, id: player3.id, input: { role: "PLAYER", branchIds: ["default"], mode: "standby", note: "" } });
      assert("D36 two owner computers do not use the seat: the one real Player still fits, and only it is counted", approved3.approvedRole === "PLAYER" && (await store.getAllocation(ws3.id)).used === 1 && (await store.listEnrollments({ workspaceId: ws3.id, actor: admin })).allocation.used === 1);
    } finally {
      await prisma.auditLog.deleteMany({ where: { workspaceId: ws3.id } });
      await prisma.workspace.delete({ where: { id: ws3.id } }).catch(() => undefined);
    }
    for (let i = 0; i < 19; i++) await store.submitRequest({ workspaceId: ws.id, userId: spamUser.id, input: input(mk(`web-spam${i}`), "REMOTE", "browser"), ip: "", userAgent: "" });
    await store.submitRequest({ workspaceId: ws.id, userId: spamUser.id, input: input(mk("web-spam19"), "REMOTE", "browser"), ip: "", userAgent: "" }).catch(() => undefined);
    assert("D24 one user cannot flood the list: at most 20 open requests", (await throws(() => store.submitRequest({ workspaceId: ws.id, userId: spamUser.id, input: input(mk("web-spam-over"), "REMOTE", "browser"), ip: "", userAgent: "" }))) === "too_many_pending_requests");

    // ── who is asking, the typed branch, the suggestions, the red-circle count (owner 2026-10-28) ──
    const who = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: { ...input(mk("web-who"), "REMOTE", "browser", b1.id), firstName: "Noa", lastName: "Levi", phone: "+972 54-765-4321", email: "noa@example.test" }, ip: "", userAgent: "" });
    const whoItem = (await store.listEnrollments({ workspaceId: ws.id, actor: mgr1 })).items.find((i) => i.id === who.id);
    assert("D27 the request carries who is asking, and the manager of that branch sees it", !!whoItem && whoItem.requesterFirstName === "Noa" && whoItem.requesterLastName === "Levi" && whoItem.requesterPhone === "+972 54-765-4321" && whoItem.requesterEmail === "noa@example.test");
    const whoAgain = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: { ...input(who.durableDeviceId, "REMOTE", "browser", b1.id), firstName: "Noa", lastName: "Levi-Cohen", phone: "+972 54-765-4321", email: "noa@example.test" }, ip: "", userAgent: "" });
    assert("D28 asking again (still pending) updates the details", whoAgain.id === who.id && whoAgain.requesterLastName === "Levi-Cohen");
    const typed = await store.submitRequest({ workspaceId: ws.id, userId: staff.userId, input: { ...input(mk("web-typed"), "PLAYER", "browser", null, "Brand New Branch"), branchAddress: "12 Herzl St, Haifa", brandName: "Shufersal Deal", firstName: "", lastName: "", phone: "", email: "" }, ip: "", userAgent: "" });
    assert("D29 a Player may ask for a branch that does not exist yet: the typed name, address and brand are kept, no branch id — and it needs no person's details", typed.requestedBranchId === null && typed.requestedBranchName === "Brand New Branch" && typed.requestedBranchAddress === "12 Herzl St, Haifa" && typed.requestedBrandName === "Shufersal Deal" && typed.requesterFirstName === "");
    assert("D30 …the main admin sees it, a branch manager does not (it is not in any branch), and it cannot be approved without choosing a real branch", (await store.listEnrollments({ workspaceId: ws.id, actor: admin })).items.some((i) => i.id === typed.id && i.requestedBranchName === "Brand New Branch") && !(await store.listEnrollments({ workspaceId: ws.id, actor: mgr1 })).items.some((i) => i.id === typed.id) && (await throws(() => store.approveEnrollment({ workspaceId: ws.id, actor: admin, id: typed.id, input: { role: "PLAYER", branchIds: [], mode: "standby", note: "" } }))) === "player_needs_exactly_one_branch");
    const hits = await store.searchBranchesForEnrollment(ws.id, "branch");
    assert("D31 typing 'branch' suggests both branches, typing 'two' only Branch Two, nothing before the first letter, nothing for a name that matches none", hits.length === 2 && (await store.searchBranchesForEnrollment(ws.id, "two")).map((x) => x.name).join() === "Branch Two" && (await store.searchBranchesForEnrollment(ws.id, "")).length === 0 && (await store.searchBranchesForEnrollment(ws.id, "   ")).length === 0 && (await store.searchBranchesForEnrollment(ws.id, "zzzz")).length === 0);
    assert("D32 a suggestion carries only id, name and city — nothing else of the company", hits.every((h) => Object.keys(h).sort().join() === "city,id,name"));
    const cAdmin = await store.countPendingForActor({ workspaceId: ws.id, actor: admin });
    const cMgr = await store.countPendingForActor({ workspaceId: ws.id, actor: mgr1 });
    const lAdmin = await store.listEnrollments({ workspaceId: ws.id, actor: admin });
    const lMgr = await store.listEnrollments({ workspaceId: ws.id, actor: mgr1 });
    assert("D33 the red-circle count equals what each person can decide: the admin all pending, the branch manager only their branch's, staff none", cAdmin.enabled && cAdmin.count === lAdmin.pendingCount && cAdmin.count > cMgr.count && cMgr.count === lMgr.pendingCount && cMgr.count >= 1 && (await store.countPendingForActor({ workspaceId: ws.id, actor: staff })).count === 0);

    // ── "I'm the owner": the admin approves his own new device at once (owner 2026-10-28) ──
    const typedItem = (await store.listEnrollments({ workspaceId: ws.id, actor: admin })).items.find((i) => i.id === typed.id);
    assert("D37 the approver sees the new branch's address and brand, and the signed-in account's e-mail when the Player gave no person", !!typedItem && typedItem.requestedBranchAddress === "12 Herzl St, Haifa" && typedItem.requestedBrandName === "Shufersal Deal" && typedItem.requestedByEmail === `enroll-staff-${tag}@example.test`);
    const ownDev = mk("web-owner-new");
    const usedBefore = (await store.getAllocation(ws.id)).used;
    const ownRow = await store.approveOwnDevice({ workspaceId: ws.id, userId: owner.id, durableDeviceId: ownDev, platform: "browser", label: "Owner · Chrome on Mac" });
    assert("D38 the owner's new device is approved at once as the owner's computer for EVERY branch — a PLAYER of class owner (the normal interface, it can play), no branch narrowing, and it takes no seat", ownRow.status === "approved" && ownRow.approvedRole === "PLAYER" && ownRow.playerClass === "owner" && ownRow.approvedBranchIds.length === 0 && ownRow.grandfathered === false && (await store.getAllocation(ws.id)).used === usedBefore);
    assert("D39 it is recorded in the audit log as a self-approval, and asking again changes nothing", (await prisma.auditLog.count({ where: { workspaceId: ws.id, action: "device.enroll_approve", entityId: ownRow.id } })) === 1 && (await store.approveOwnDevice({ workspaceId: ws.id, userId: owner.id, durableDeviceId: ownDev, platform: "browser", label: "x" })).id === ownRow.id);
    const mgrWho = rules.enrollmentClaimFor(ownRow, new Date());
    assert("D40 its token claim is PLAYER (the WS server does not force CONTROL on it — it plays as usual), with no branch narrowing", mgrWho === "PLAYER" && rules.restrictBranches(["b1", "b2"], ownRow.approvedBranchIds).length === 2);

    // ── audit + switching off ──
    const actions = (await prisma.auditLog.findMany({ where: { workspaceId: ws.id }, select: { action: true } })).map((a) => a.action);
    assert("D25 every request, approval, rejection, revocation and settings change is in the audit log", ["device.enroll_request", "device.enroll_approve", "device.enroll_reject", "device.enroll_revoke", "enrollment.settings"].every((a) => actions.includes(a)));
    await store.disableEnrollment({ workspaceId: ws.id, actorUserId: owner.id });
    assert("D26 switching it off returns the workspace to today's behaviour (config off; the rows stay for the next time)", (await store.getEnrollmentConfig(ws.id)).enabled === false && (await prisma.deviceEnrollment.count({ where: { workspaceId: ws.id } })) > 0);
    assert("D41 with approvals switched off the owner's self-approval is refused (nothing to approve)", (await throws(() => store.approveOwnDevice({ workspaceId: ws.id, userId: owner.id, durableDeviceId: mk("web-owner-off"), platform: "browser", label: "" }))) === "enrollment_disabled");
    assert("D34 switched off: no suggestions, a count of zero, and the table is not read", (await store.searchBranchesForEnrollment(ws.id, "branch")).length === 0 && (await store.countPendingForActor({ workspaceId: ws.id, actor: admin })).count === 0 && (await store.countPendingForActor({ workspaceId: ws.id, actor: admin })).enabled === false);
  } finally {
    await prisma.auditLog.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.stationDevice.deleteMany({ where: { workspaceId: ws.id } });
    await prisma.workspace.delete({ where: { id: ws.id } }).catch((e) => console.error("cleanup workspace failed", e instanceof Error ? e.message : e));
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${tag}@example.test` } } }).catch((e) => console.error("cleanup users failed", e instanceof Error ? e.message : e));
    await prisma.$disconnect();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
