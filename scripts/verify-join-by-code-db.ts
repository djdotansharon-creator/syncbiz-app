/**
 * Join by code against a REAL (local) database — the store (lib/join-by-code-store.ts) end to end: a code is made and only its hash kept, a person's request (new / existing account), the code is
 * single-use (also under a race), wrong / expired codes look the same, the decision (approve with a role / reject), the full-workspace case leaves nothing behind, the audit log. Builds a throwaway
 * workspace and removes it again. REFUSES to run against anything but a localhost database.
 *
 * Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-join-by-code-db.ts
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

async function main() {
  const { prisma } = await import("../lib/prisma");
  const store = await import("../lib/join-by-code-store");
  const rules = await import("../lib/join-by-code");
  const { validateCredentialsAsync } = await import("../lib/auth");
  const { hashPassword } = await import("../lib/password-utils");
  const rate = await import("../lib/auth-rate-limit");
  const tag = randomUUID().slice(0, 8);
  const mail = (n: string) => `${n}-${tag}@example.test`;
  const hdr = (ip = "10.0.0.1") => new Headers({ "x-forwarded-for": ip });
  const throws = async (fn: () => Promise<unknown>): Promise<string> => {
    try {
      await fn();
      return "";
    } catch (e) {
      return e instanceof store.JoinError ? e.code : `other:${e instanceof Error ? e.message : String(e)}`;
    }
  };
  const person = (n: string, code: string, over: Partial<import("../lib/join-by-code").JoinInput> = {}) => ({ code, email: mail(n), password: "secret-pw-1", firstName: "Dana", lastName: n, phone: "050-1234567", ...over });

  const owner = await prisma.user.create({ data: { email: mail("owner"), role: "WORKSPACE_ADMIN", passwordHash: hashPassword("owner-pw-1") } });
  const ws = await prisma.workspace.create({ data: { name: `Join test ${tag}`, slug: `join-test-${tag}`, ownerId: owner.id, members: { create: { userId: owner.id, role: "WORKSPACE_ADMIN" } } } });
  const other = await prisma.workspace.create({ data: { name: `Join other ${tag}`, slug: `join-other-${tag}`, ownerId: owner.id } });
  const extraWs: string[] = [];
  const newCode = async () => (await store.createJoinCode({ workspaceId: ws.id, actorUserId: owner.id })).code;

  try {
    rate.__resetRateLimit();
    // ── the code ──
    const made = await store.createJoinCode({ workspaceId: ws.id, actorUserId: owner.id });
    const norm = rules.normalizeJoinCode(made.code);
    const stored = await prisma.workspaceJoinCode.findMany({ where: { workspaceId: ws.id } });
    assert("D1 a code is shown as ABCD-EFGH, lives ~90 seconds, and only its HASH is stored (the code is nowhere in the table)", /^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(made.code) && stored.length === 1 && stored[0].codeHash === rules.hashJoinCode(norm) && JSON.stringify(stored[0]).indexOf(norm) === -1 && Math.abs(new Date(made.expiresAt).getTime() - Date.now() - 90_000) < 5000);
    assert("D2 making a code is in the audit log", (await prisma.auditLog.count({ where: { workspaceId: ws.id, action: "join.code_create" } })) === 1);

    // ── a person who OPENED the link keeps his code alive while he types his details (the code renews every minute on the owner's screen — owner 2026-10-31) ──
    const cl = await newCode();
    const clRow = () => prisma.workspaceJoinCode.findUnique({ where: { codeHash: rules.hashJoinCode(rules.normalizeJoinCode(cl)) } });
    const clBefore = (await clRow())!.expiresAt.getTime();
    await store.claimJoinCode(cl, hdr("10.0.9.1"));
    const clAfter = (await clRow())!.expiresAt.getTime();
    const clSubmit = await store.submitJoinRequest(person("claimed", cl), hdr());
    assert("D2b opening the link keeps THAT code alive for 10 minutes (it was about to expire in ~90 s), and it is still used up by the first request", clBefore - Date.now() < 91_000 && Math.abs(clAfter - Date.now() - 600_000) < 5000 && clSubmit.ok && (await throws(() => store.submitJoinRequest(person("claimed2", cl), hdr()))) === "bad_code");
    await prisma.workspaceJoinRequest.deleteMany({ where: { workspaceId: ws.id, email: mail("claimed") } }); // keep the later counts about the people the other checks make
    const expiredCode = await newCode();
    await prisma.workspaceJoinCode.update({ where: { codeHash: rules.hashJoinCode(rules.normalizeJoinCode(expiredCode)) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const expiredAt = (await prisma.workspaceJoinCode.findUnique({ where: { codeHash: rules.hashJoinCode(rules.normalizeJoinCode(expiredCode)) } }))!.expiresAt.getTime();
    const claimWrong = await throws(() => store.claimJoinCode("ABCD-EFGH", hdr("10.0.9.2")));
    const claimUsed = await throws(() => store.claimJoinCode(cl, hdr("10.0.9.3")));
    const claimExpired = await throws(() => store.claimJoinCode(expiredCode, hdr("10.0.9.4")));
    const expiredAfter = (await prisma.workspaceJoinCode.findUnique({ where: { codeHash: rules.hashJoinCode(rules.normalizeJoinCode(expiredCode)) } }))!.expiresAt.getTime();
    assert("D2c claiming a wrong, a used or an expired code gives the same answer and brings nothing back to life", claimWrong === "bad_code" && claimUsed === "bad_code" && claimExpired === "bad_code" && expiredAfter === expiredAt);
    rate.__resetRateLimit();

    // ── a NEW person asks ──
    const r1 = await store.submitJoinRequest(person("noa", made.code), hdr());
    const noaUser = await prisma.user.findUnique({ where: { email: mail("noa") } });
    const reqNoa = await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("noa") } });
    assert("D3 a new person gets a pending request and NO account yet (so they cannot sign in); only the password HASH is kept", r1.ok && r1.hasAccount === false && noaUser === null && reqNoa?.status === "pending" && !!reqNoa.passwordHash && reqNoa.passwordHash !== "secret-pw-1" && reqNoa.userId === null && !(await validateCredentialsAsync(mail("noa"), "secret-pw-1")));
    assert("D4 the code is used up: the same code again is refused", (await throws(() => store.submitJoinRequest(person("late", made.code), hdr()))) === "bad_code");
    assert("D5 a wrong code, an already-used code and an expired code all give the same answer", (await throws(() => store.submitJoinRequest(person("x1", "ABCD-EFGH"), hdr("10.0.0.2")))) === "bad_code" && (await (async () => {
      const c = await newCode();
      await prisma.workspaceJoinCode.update({ where: { codeHash: rules.hashJoinCode(rules.normalizeJoinCode(c)) }, data: { expiresAt: new Date(Date.now() - 1000) } });
      return throws(() => store.submitJoinRequest(person("x2", c), hdr("10.0.0.3")));
    })()) === "bad_code");

    // ── an EXISTING person asks ──
    // a signed-in account always belongs to a business of its own (sign-up makes one), and sign-in needs it — so Dan's has one
    const dan = await prisma.user.create({ data: { email: mail("dan"), role: "WORKSPACE_ADMIN", passwordHash: hashPassword("dan-pw-1") } });
    const danWs = await prisma.workspace.create({ data: { name: `Dan's own ${tag}`, slug: `join-dan-${tag}`, ownerId: dan.id, members: { create: { userId: dan.id, role: "WORKSPACE_ADMIN" } } } });
    extraWs.push(danWs.id);
    const c2 = await newCode();
    assert("D6 a person who already has an account must give THAT account's password (a wrong one is refused and the code is not used up)", (await throws(() => store.submitJoinRequest(person("dan", c2, { password: "wrong-pw-1" }), hdr("10.0.0.4")))) === "wrong_password" && (await prisma.workspaceJoinCode.findUnique({ where: { codeHash: rules.hashJoinCode(rules.normalizeJoinCode(c2)) } }))?.usedAt === null);
    const r2 = await store.submitJoinRequest(person("dan", c2, { password: "dan-pw-1" }), hdr("10.0.0.4"));
    const reqDan = await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("dan") } });
    assert("D7 with the right password the request points at the existing account and stores no password hash", r2.hasAccount === true && reqDan?.userId === dan.id && reqDan.passwordHash === null);
    assert("D8 asking again while a request is pending is refused (and does not use a code up)", (await (async () => {
      const c = await newCode();
      const code = await throws(() => store.submitJoinRequest(person("noa", c), hdr("10.0.0.5")));
      const used = (await prisma.workspaceJoinCode.findUnique({ where: { codeHash: rules.hashJoinCode(rules.normalizeJoinCode(c)) } }))?.usedAt;
      return code === "already_pending" && used === null;
    })()));
    // an existing member is told so
    const member = await prisma.user.create({ data: { email: mail("mem"), role: "CONTROLLER", passwordHash: hashPassword("mem-pw-1") } });
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: member.id, role: "CONTROLLER" } });
    assert("D9 someone who is already a member is told so", (await throws(async () => store.submitJoinRequest(person("mem", await newCode(), { password: "mem-pw-1" }), hdr("10.0.0.6")))) === "already_member");

    // ── the admin's list and decisions ──
    const list = await store.listJoinRequests(ws.id);
    assert("D10 the admin sees the two waiting people (not the other workspace's), with whether each already has an account", list.length === 2 && list.some((x) => x.email === mail("noa") && x.hasAccount === false) && list.some((x) => x.email === mail("dan") && x.hasAccount === true) && (await store.listJoinRequests(other.id)).length === 0 && (await store.countPendingJoinRequests(ws.id)) === 2);
    assert("D11 approving needs a role; another workspace's admin cannot decide this request", (await throws(() => store.decideJoinRequest({ workspaceId: ws.id, requestId: reqNoa!.id, actorUserId: owner.id, decision: "approve" }))) === "role_required" && (await throws(() => store.decideJoinRequest({ workspaceId: other.id, requestId: reqNoa!.id, actorUserId: owner.id, decision: "approve", role: "MEMBER" }))) === "not_found");
    await store.decideJoinRequest({ workspaceId: ws.id, requestId: reqNoa!.id, actorUserId: owner.id, decision: "approve", role: "MEMBER" });
    const noa2 = await prisma.user.findUnique({ where: { email: mail("noa") } });
    const memNoa = noa2 ? await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: noa2.id } } }) : null;
    const reqNoa2 = await prisma.workspaceJoinRequest.findUnique({ where: { id: reqNoa!.id } });
    assert("D12 approving a NEW person makes their own account (the password they chose works), a member with the chosen role, and clears the stored hash", !!noa2 && noa2.firstName === "Dana" && memNoa?.role === "CONTROLLER" && (await validateCredentialsAsync(mail("noa"), "secret-pw-1")) && reqNoa2?.status === "approved" && reqNoa2.passwordHash === null && reqNoa2.approvedRole === "MEMBER");
    await store.decideJoinRequest({ workspaceId: ws.id, requestId: reqDan!.id, actorUserId: owner.id, decision: "approve", role: "MANAGER" });
    const memDan = await prisma.workspaceMember.findUnique({ where: { workspaceId_userId: { workspaceId: ws.id, userId: dan.id } } });
    assert("D13 approving an EXISTING person adds that account to the business as a manager, without touching their password", memDan?.role === "MANAGER" && (await validateCredentialsAsync(mail("dan"), "dan-pw-1")) && (await prisma.user.count({ where: { email: mail("dan") } })) === 1);
    assert("D14 a decided request cannot be decided again", (await throws(() => store.decideJoinRequest({ workspaceId: ws.id, requestId: reqNoa!.id, actorUserId: owner.id, decision: "reject" }))) === "not_pending");

    // ── reject ──
    const c3 = await newCode();
    await store.submitJoinRequest(person("ron", c3, {}), hdr("10.0.0.7"));
    const reqRon = (await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("ron") } }))!;
    await store.decideJoinRequest({ workspaceId: ws.id, requestId: reqRon.id, actorUserId: owner.id, decision: "reject" });
    assert("D15 rejecting closes the request, drops the stored hash and makes no account", (await prisma.workspaceJoinRequest.findUnique({ where: { id: reqRon.id } }))?.status === "rejected" && (await prisma.workspaceJoinRequest.findUnique({ where: { id: reqRon.id } }))?.passwordHash === null && (await prisma.user.findUnique({ where: { email: mail("ron") } })) === null);

    // ── expiry of a request ──
    const c4 = await newCode();
    await store.submitJoinRequest(person("eli", c4), hdr("10.0.0.8"));
    const reqEli = (await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("eli") } }))!;
    await prisma.workspaceJoinRequest.update({ where: { id: reqEli.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert("D16 a request past its 7 days is not listed and cannot be approved", (await store.listJoinRequests(ws.id)).length === 0 && (await throws(() => store.decideJoinRequest({ workspaceId: ws.id, requestId: reqEli.id, actorUserId: owner.id, decision: "approve", role: "MEMBER" }))) === "not_pending");

    // ── a full workspace leaves nothing behind ──
    const c5 = await newCode();
    await prisma.workspaceJoinRequest.update({ where: { id: reqEli.id }, data: { status: "rejected" } });
    await store.submitJoinRequest(person("full", c5), hdr("10.0.0.9"));
    const reqFull = (await prisma.workspaceJoinRequest.findFirst({ where: { workspaceId: ws.id, email: mail("full") } }))!;
    const memCount = await prisma.workspaceMember.count({ where: { workspaceId: ws.id } });
    await prisma.workspaceEntitlement.upsert({ where: { workspaceId: ws.id }, update: { maxUsers: memCount }, create: { workspaceId: ws.id, maxUsers: memCount, status: "TRIALING" } as never });
    process.env.SYNCBIZ_ENFORCE_LIMITS = "1"; // seat limits are only enforced when the platform switches them on
    const fullErr = await throws(() => store.decideJoinRequest({ workspaceId: ws.id, requestId: reqFull.id, actorUserId: owner.id, decision: "approve", role: "MEMBER" }));
    assert("D17 when the business has no seat left, approval is refused, no account is made and the request stays pending", fullErr.startsWith("other:") && fullErr.includes("limit") && (await prisma.user.findUnique({ where: { email: mail("full") } })) === null && (await prisma.workspaceJoinRequest.findUnique({ where: { id: reqFull.id } }))?.status === "pending");
    delete process.env.SYNCBIZ_ENFORCE_LIMITS;
    await prisma.workspaceEntitlement.deleteMany({ where: { workspaceId: ws.id } });

    // ── a race for one code ──
    const c6 = await newCode();
    const results = await Promise.all([store.submitJoinRequest(person("race1", c6), hdr("10.0.1.1")).then(() => "ok", (e) => (e as { code?: string }).code ?? "err"), store.submitJoinRequest(person("race2", c6), hdr("10.0.1.2")).then(() => "ok", (e) => (e as { code?: string }).code ?? "err")]);
    assert("D18 two people typing the same code at the same moment: exactly one gets in", results.filter((x) => x === "ok").length === 1 && results.filter((x) => x === "bad_code").length === 1, results);

    // ── limits ──
    await prisma.workspaceJoinCode.deleteMany({ where: { workspaceId: ws.id } });
    for (let i = 0; i < rules.MAX_ACTIVE_CODES; i += 1) await newCode();
    assert("D19 a workspace cannot hold more than 10 unused codes at once", (await throws(() => store.createJoinCode({ workspaceId: ws.id, actorUserId: owner.id }))) === "too_many_codes");
    rate.__resetRateLimit();
    let last = "";
    for (let i = 0; i < 11; i += 1) last = await throws(() => store.submitJoinRequest(person("guess", "ZZZZ-ZZZZ"), hdr("10.0.2.1")));
    assert("D20 guessing codes is slowed down: after 10 wrong tries from one place the answer is 'try later'", last === "rate_limited", last);
    assert("D21 a malformed request is refused before anything is read", (await throws(() => store.submitJoinRequest(person("bad", "nope"), hdr("10.0.3.1")))) === "code" && (await throws(() => store.submitJoinRequest(person("bad2", made.code, { password: "1" }), hdr("10.0.3.2")))) === "password");

    // ── audit ──
    const actions = (await prisma.auditLog.findMany({ where: { workspaceId: ws.id }, select: { action: true } })).map((a) => a.action);
    assert("D22 codes, approvals and rejections are all in the audit log", ["join.code_create", "join.approve", "join.reject"].every((a) => actions.includes(a)));
  } finally {
    await prisma.auditLog.deleteMany({ where: { workspaceId: { in: [ws.id, other.id, ...extraWs] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [ws.id, other.id, ...extraWs] } } }).catch((e) => console.error("cleanup workspace failed", e instanceof Error ? e.message : e));
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
