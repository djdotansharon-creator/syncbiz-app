/**
 * SECURITY HOTFIX (owner 2026-10-13) — management role enforcement + desktop-station Management Lock + rate limits.
 * Behavioural tests of the pure pieces (unlock token, desktop detection, rate limiter) + static wiring guards.
 * Run: npx tsx scripts/verify-management-security.ts
 */
import { readFileSync } from "fs";

process.env.SYNCBIZ_SESSION_SECRET = process.env.SYNCBIZ_SESSION_SECRET || "test-secret-0123456789abcdef";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail = ""): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const read = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

async function main() {
  const mu = await import("../lib/management-unlock");
  const rl = await import("../lib/auth-rate-limit");
  const sess = await import("../lib/auth-session");

  // ── desktop detection: ONLY the VONO desktop app (Electron) is locked; browsers never ──
  const ELECTRON = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) SyncBizPlayer/2.2.8-beta.23 Chrome/132.0.6834.210 Electron/34.5.8 Safari/537.36";
  const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
  const MAC_CHROME = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
  assert("S1 desktop app (Electron UA) → lock applies", mu.isDesktopAppUa(ELECTRON));
  assert("S2 Mac Safari / Mac Chrome / no UA → never locked (HQ browser, no extra prompt)", !mu.isDesktopAppUa(MAC_SAFARI) && !mu.isDesktopAppUa(MAC_CHROME) && !mu.isDesktopAppUa(null));

  // ── unlock token ──
  const now = 1_800_000_000;
  const { value, exp } = await mu.createUnlockValue("Boss@Shop.com", now);
  assert("S3 unlock valid for its own account for 60 min", exp === now + 3600 && (await mu.verifyUnlockValue(value, "boss@shop.com", now)) === exp && (await mu.verifyUnlockValue(value, "boss@shop.com", now + 3599)) === exp);
  assert("S4 expired after 60 min of inactivity (no touch)", (await mu.verifyUnlockValue(value, "boss@shop.com", now + 3600)) === null);
  assert("S5 another account's unlock is ignored", (await mu.verifyUnlockValue(value, "employee@shop.com", now)) === null);
  const parts = value.split(".");
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify({ email: "boss@shop.com", exp: now + 99999 })).toString("base64url")}.${parts[2]}`;
  assert("S6 tampered payload (longer exp) → rejected", (await mu.verifyUnlockValue(forged, "boss@shop.com", now)) === null);
  const sessionCookie = await sess.createSessionValue("boss@shop.com");
  assert("S7 the 7-day SESSION cookie can never be used as an unlock (domain separated)", (await mu.verifyUnlockValue(sessionCookie, "boss@shop.com")) === null && (await sess.parseSessionValue(value)) === null);
  const saved = process.env.SYNCBIZ_SESSION_SECRET;
  process.env.SYNCBIZ_SESSION_SECRET = "short";
  assert("S8 fail-closed without a proper secret", (await mu.verifyUnlockValue(value, "boss@shop.com", now)) === null);
  process.env.SYNCBIZ_SESSION_SECRET = saved;
  const opts = mu.unlockCookieOptions() as Record<string, unknown>;
  assert("S9 cookie = httpOnly + SameSite=Strict + NO maxAge/expires (dies when the app closes)", opts.httpOnly === true && opts.sameSite === "strict" && !("maxAge" in opts) && !("expires" in opts));

  // ── rate limiter ──
  rl.__resetRateLimit();
  const t0 = 1_000_000;
  for (let i = 0; i < 9; i++) rl.recordFailure("login:a@b.c", t0 + i);
  const after9 = rl.retryAfterMs("login:a@b.c", t0 + 10);
  rl.recordFailure("login:a@b.c", t0 + 10);
  const after10 = rl.retryAfterMs("login:a@b.c", t0 + 11);
  assert("S10 account: 9 wrong passwords allowed, the 10th blocks for 5 min", after9 === 0 && after10 > 4 * 60 * 1000 && after10 <= 5 * 60 * 1000 && rl.retryAfterMs("login:a@b.c", t0 + 11 + 5 * 60 * 1000) === 0);
  rl.__resetRateLimit();
  for (let i = 0; i < 4; i++) rl.recordFailure("login:x@y.z", t0 + i);
  rl.recordSuccess("login:x@y.z");
  rl.recordFailure("login:x@y.z", t0 + 10);
  assert("S11 a successful login clears the counter", rl.retryAfterMs("login:x@y.z", t0 + 11) === 0);
  rl.__resetRateLimit();
  for (let i = 0; i < 9; i++) rl.recordFailure("login:slow@y.z", t0 + i * 2 * 60 * 1000);
  rl.recordFailure("login:slow@y.z", t0 + 20 * 60 * 1000);
  assert("S12 failures older than 15 min do not count", rl.retryAfterMs("login:slow@y.z", t0 + 20 * 60 * 1000 + 1) === 0);
  rl.__resetRateLimit();
  for (let i = 0; i < 19; i++) rl.recordFailure("login-ip:1.2.3.4", t0 + i);
  const ip19 = rl.retryAfterMs("login-ip:1.2.3.4", t0 + 20);
  rl.recordFailure("login-ip:1.2.3.4", t0 + 20);
  assert("S13 address: an office IP blocks only after 20 failures", ip19 === 0 && rl.retryAfterMs("login-ip:1.2.3.4", t0 + 21) > 0);
  const h = new Headers({ "x-forwarded-for": "9.8.7.6, 10.0.0.1" });
  assert("S14 keys = account + client address (first x-forwarded-for)", JSON.stringify(rl.attemptKeys("login", " A@B.C ", h)) === JSON.stringify(["login:a@b.c", "login-ip:9.8.7.6"]));

  // ── wiring ──
  const gate = read("components/management/management-gate.tsx");
  assert("W1 gate: not signed in → login · not a manager → /sources · locked → lock screen · else page",
    /if \(!a\.signedIn\) redirect\(/.test(gate) && /if \(!a\.canManage\) redirect\("\/sources"\)/.test(gate) && /if \(!a\.unlocked\) return <ManagementLockScreen \/>/.test(gate));
  for (const [name, p, from] of [["Dashboard", "app/(app)/dashboard/page.tsx", "/dashboard"], ["Control Room", "app/(app)/owner/control-room/page.tsx", "/owner/control-room"], ["Access Control", "app/(app)/access-control/page.tsx", "/access-control"]] as const) {
    assert(`W2 ${name} page is wrapped by ManagementGate`, read(p).includes(`<ManagementGate from="${from}">`));
  }
  const dash = read("app/(app)/dashboard/page.tsx");
  assert("W3 Dashboard data is loaded only INSIDE the gate (locked / non-manager → no data fetch)", /<DashboardContent \/>/.test(dash) && /async function DashboardContent\(\) \{[\s\S]*await getData\(\)/.test(dash));
  const access = read("lib/management-access.ts");
  assert("W4 manager = access type OWNER (same rule as the Control Room APIs); lock only for the desktop app",
    /getAccessType\(user\.id, user\.tenantId\)\) === "OWNER"/.test(access) && /unlocked: !desktop \|\| unlockExp !== null/.test(access));
  assert("W5 Control Room APIs: locked desktop station → 423", /if \(await isManagementLockedForRequest\(\)\) return \{ ok: false, response: managementLockedResponse\(\) \};/.test(read("lib/control-room-auth.ts")));
  assert("W6 Access Control APIs: locked desktop station → no admin (403)", /requireWorkspaceAdmin[\s\S]{0,600}if \(await isManagementLockedForRequest\(\)\) return null;/.test(read("lib/auth-helpers.ts")));
  assert("W7 MASTER designation admin API + HQ jingle audience change: behind the lock",
    /isManagementLockedForRequest\(\)\) return \{ error: managementLockedResponse\(\) \}/.test(read("app/api/admin/branch-master/route.ts")) &&
    /isManagementLockedForRequest\(\)\) return managementLockedResponse\(\)/.test(read("app/api/jingles/library/[id]/route.ts")));
  const route = read("app/api/auth/management-unlock/route.ts");
  assert("W8 unlock: managers only, rate-limited, real password check; touch only extends a VALID unlock; DELETE locks",
    /if \(!a\.canManage\) return NextResponse\.json\(\{ error: "Only a manager/.test(route) && /blockedFor\(keys\)/.test(route) &&
    /validateCredentialsAsync\(a\.email, password\)/.test(route) && /export async function PUT\(\) \{[\s\S]*a\.unlockExp === null\) return NextResponse\.json\(\{ unlocked: false \}/.test(route) &&
    /export async function DELETE\(\)[\s\S]*maxAge: 0/.test(route));
  assert("W9 login + manager re-auth (verify-password) are rate-limited",
    /attemptKeys\("login", normEmail, req\.headers\)/.test(read("app/api/auth/login/route.ts")) && /attemptKeys\("reauth", email, req\.headers\)/.test(read("app/api/auth/verify-password/route.ts")));
  const lock = read("components/management/management-lock.tsx");
  assert("W10 lock screen: Back to Player is a plain link to /sources (no password)", /<Link href="\/sources"[^>]*>← Back to Player<\/Link>/.test(lock));
  assert("W11 inactivity: 60 min idle → lock; real activity extends at most once a minute (polling never)",
    /const IDLE_MS = 60 \* 60 \* 1000;/.test(lock) && /const TOUCH_EVERY_MS = 60 \* 1000;/.test(lock) && /\["pointerdown", "keydown", "wheel", "touchstart"\]/.test(lock));
  const shell = read("components/app-shell.tsx");
  assert("W12 header: management entries only for managers (gear menu + pinned nav)",
    /const MANAGEMENT_NAV_KEYS = new Set<string>\(\["dashboard", "controlRoom", "access-control", "owner", "display-design"\]\);/.test(shell) &&
    (shell.match(/canManage \|\| !MANAGEMENT_NAV_KEYS\.has\(item\.labelKey\)/g) ?? []).length === 2);
  // The run-start lock lives in app-shell; the Lock button is desktop-only and now sits in the management tabs (components/management/management-tabs.tsx — the design moved it from the
  // old header). Same invariant, so the check accepts either file (2026-10-23, merge of the redesign: a brittle location check, not a behaviour change).
  const mgmtTabs = read("components/management/management-tabs.tsx");
  assert("W13 desktop: every app run starts locked; Lock button only in the desktop app",
    /sessionStorage\.setItem\("vono-mgmt-run", "1"\)[\s\S]{0,200}method: "DELETE"/.test(shell) && /\{(?:isDesktopApp|desktop) \? \(\s*<button[\s\S]{0,200}Lock management on this station/.test(shell + "\n" + mgmtTabs));
  console.log(`\n${pass} passed, ${fail} failed`);
}
void main();
