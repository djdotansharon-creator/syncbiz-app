/**
 * The owner's-own-computer claim (owner 2026-10-29): minted only for an approved PLAYER of class "owner", signed in the token, read by the WS server — and the shared rule that decides it.
 * No database, no network. Run: npx tsx scripts/verify-owner-claim.ts
 */
process.env.SYNCBIZ_WS_SECRET = "test-ws-secret-owner-claim-0123456789";
process.env.WS_SECRET = process.env.SYNCBIZ_WS_SECRET;

import { decideMint } from "../lib/device-enrollment";
import { createWsToken } from "../lib/auth-ws-token";
import { verifyWsToken } from "../server/ws-token";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

const now = new Date("2026-10-29T12:00:00Z");
const row = (approvedRole: string, playerClass: string | null) => ({ status: "approved", expiresAt: new Date(now.getTime() + 86_400_000), requestedAt: now, approvedRole, playerClass, approvedBranchIds: [] as string[], decisionNote: "" });
const mint = (r: ReturnType<typeof row>) => decideMint({ enabled: true, userAgent: "Mozilla/5.0 Chrome", durableDeviceId: "web-abc123", row: r, now });

const o = mint(row("PLAYER", "owner"));
const b = mint(row("PLAYER", "browser"));
const s = mint(row("PLAYER", "station"));
const r = mint(row("REMOTE", null));
assert("O1 only a PLAYER of class owner is the owner's own computer (a browser Player, a station and a Remote are not)", o.kind === "approved" && o.owner === true && b.kind === "approved" && b.owner === false && s.kind === "approved" && s.owner === false && r.kind === "approved" && r.owner === false);

const decode = (t: string) => JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString("utf-8")) as Record<string, unknown>;
assert("O2 the token carries the owner claim only with a PLAYER claim, and never otherwise", decode(createWsToken("u1", { enrollmentRole: "PLAYER", enrollmentOwner: true })).enrollmentOwner === true && decode(createWsToken("u1", { enrollmentRole: "REMOTE", enrollmentOwner: true })).enrollmentOwner === undefined && decode(createWsToken("u1", { enrollmentRole: "PLAYER" })).enrollmentOwner === undefined && decode(createWsToken("u1", {})).enrollmentOwner === undefined);
const v = (claims: Parameters<typeof createWsToken>[1]) => verifyWsToken(createWsToken("u1", claims));
assert("O3 the WS server reads it from the SIGNED token (true only for an owner PLAYER; legacy tokens read false)", v({ enrollmentRole: "PLAYER", enrollmentOwner: true })?.enrollmentOwner === true && v({ enrollmentRole: "PLAYER" })?.enrollmentOwner === false && v({})?.enrollmentOwner === false && v({ enrollmentRole: "REMOTE" })?.enrollmentOwner === false);
const forged = (() => {
  const t = createWsToken("u1", { enrollmentRole: "PLAYER" });
  const [p, sig] = t.split(".");
  const payload = decode(t);
  payload.enrollmentOwner = true;
  return `${Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url")}.${sig}`;
})();
assert("O4 a token edited to add the owner claim fails the signature (cannot be forged by a client)", verifyWsToken(forged) === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
