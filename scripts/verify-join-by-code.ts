/**
 * Join by code — the pure rules (lib/join-by-code.ts): the env flag, the code alphabet and shape, normalising what a person types, hashing, the 10-minute / 7-day lifetimes, the input checks, the roles.
 * No database, no browser. Run: npx tsx scripts/verify-join-by-code.ts
 */
import * as j from "../lib/join-by-code";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

assert("J1 the feature needs the env flag to be 1 or true (unset / 0 / yes are all off)", !j.isJoinEnvEnabled({}) && !j.isJoinEnvEnabled({ SYNCBIZ_JOIN_BY_CODE: "0" }) && !j.isJoinEnvEnabled({ SYNCBIZ_JOIN_BY_CODE: "yes" }) && j.isJoinEnvEnabled({ SYNCBIZ_JOIN_BY_CODE: "1" }) && j.isJoinEnvEnabled({ SYNCBIZ_JOIN_BY_CODE: "true" }));

const codes = Array.from({ length: 300 }, () => j.generateJoinCode());
assert("J2 a code is 8 symbols from an alphabet without I, O, 0 and 1", codes.every((c) => c.length === 8 && /^[A-HJ-NP-Z2-9]{8}$/.test(c)));
assert("J3 300 fresh codes are all different (and every one is well-formed)", new Set(codes).size === 300 && codes.every((c) => j.isWellFormedJoinCode(c)));
assert("J4 what a person types is normalised: case, dashes and spaces do not matter", j.normalizeJoinCode(" abcd-efgh ") === "ABCDEFGH" && j.normalizeJoinCode("ab cd\tef-gh") === "ABCDEFGH" && j.formatJoinCode("ABCDEFGH") === "ABCD-EFGH");
assert("J5 a code with an ambiguous symbol or the wrong length is not well-formed", !j.isWellFormedJoinCode("ABCDEFG0") && !j.isWellFormedJoinCode("ABCDEFGI") && !j.isWellFormedJoinCode("ABCDEFG") && !j.isWellFormedJoinCode("ABCDEFGHJ") && !j.isWellFormedJoinCode(""));
assert("J6 the hash is stable, differs per code, and never contains the code", j.hashJoinCode("ABCDEFGH") === j.hashJoinCode("ABCDEFGH") && j.hashJoinCode("ABCDEFGH") !== j.hashJoinCode("ABCDEFGJ") && !j.hashJoinCode("ABCDEFGH").includes("ABCDEFGH") && /^[0-9a-f]{64}$/.test(j.hashJoinCode("ABCDEFGH")));

const t0 = 1_800_000_000_000;
assert("J7 a code lives 90 seconds (shown 60 s, then renewed — owner 2026-10-31), a person who opened the link gets 10 minutes to type his details, a request 7 days", j.joinCodeExpiresAt(t0).getTime() === t0 + 90_000 && j.joinClaimExpiresAt(t0).getTime() === t0 + 10 * 60_000 && j.JOIN_CODE_RENEW_MS === 60_000 && j.JOIN_CODE_RENEW_MS < j.JOIN_CODE_TTL_MS && j.joinRequestExpiresAt(t0).getTime() === t0 + 7 * 86_400_000);
const pend = { status: "pending", expiresAt: new Date(t0 + 1000) };
assert("J8 a pending request past its date reads as expired; a decided one never does", j.effectiveJoinStatus(pend, t0) === "pending" && j.effectiveJoinStatus(pend, t0 + 2000) === "expired" && j.effectiveJoinStatus({ status: "approved", expiresAt: new Date(0) }, t0) === "approved" && j.effectiveJoinStatus({ status: "rejected", expiresAt: new Date(0) }, t0) === "rejected");

const good: j.JoinInput = { code: "abcd-efgh", email: "dana@example.com", password: "secret1", firstName: "Dana", lastName: "Cohen", phone: "050-1234567" };
assert("J9 a complete request is accepted", j.validateJoinInput(good) === null);
assert("J10 each missing or bad part is named", j.validateJoinInput({ ...good, code: "nope" }) === "code" && j.validateJoinInput({ ...good, email: "dana" }) === "email" && j.validateJoinInput({ ...good, password: "12345" }) === "password" && j.validateJoinInput({ ...good, firstName: " " }) === "first_name" && j.validateJoinInput({ ...good, lastName: "" }) === "last_name" && j.validateJoinInput({ ...good, phone: "abc" }) === "phone");
assert("J11 the phone is optional, and an international one is fine", j.validateJoinInput({ ...good, phone: "" }) === null && j.validateJoinInput({ ...good, phone: "+972 50 123 4567" }) === null);
assert("J12 only the two known roles are accepted, and they map to the platform's existing tenant roles", j.parseJoinRole("MANAGER") === "MANAGER" && j.parseJoinRole("MEMBER") === "MEMBER" && j.parseJoinRole("OWNER") === null && j.parseJoinRole(undefined) === null && j.tenantRoleForJoinRole("MANAGER") === "TENANT_ADMIN" && j.tenantRoleForJoinRole("MEMBER") === "TENANT_MEMBER");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
