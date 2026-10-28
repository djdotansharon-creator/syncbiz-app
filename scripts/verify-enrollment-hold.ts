/**
 * Device enrollment — the HOLD (owner 2026-10-28: "like Spotify, the player does not work until you are in the account"). Source-text guards (no browser): the app is wrapped by the hold in the (app) layout, the
 * decision is made on the server only for a signed-in non-desktop caller and never throws, a switched-off workspace renders the children untouched, the old always-mounted gate is gone from the provider
 * tree, the request screen never reads the company's whole branch list, and the red circle asks a route that returns a number only. Run: npx tsx scripts/verify-enrollment-hold.ts
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

const layout = read("app/(app)/layout.tsx");
const hold = read("components/enrollment-hold.tsx");
const providers = read("app/(app)/providers.tsx");
const gate = read("components/enrollment-gate.tsx");
const hook = read("lib/use-enrollment-gate.ts");
const dot = read("components/enrollment-pending-dot.tsx");
const summary = read("lib/use-enrollment-summary.ts");
const branchesView = read("components/control-room/all-branches-view.tsx");
const crPage = read("app/(app)/owner/control-room/page.tsx");
const panel = read("components/control-room/device-enrollment-panel.tsx");
const gateCss = read("components/enrollment-gate.css");
const ownerRoute = read("app/api/devices/enrollment/owner/route.ts");
const statusRoute = read("app/api/devices/enrollment/status/route.ts");
const countRoute = read("app/api/control-room/enrollments/pending-count/route.ts");
const branchRoute = read("app/api/devices/enrollment/branches/route.ts");
const shell = read("components/app-shell.tsx");

assert("H1 the (app) layout wraps the WHOLE provider tree in the hold, so nothing of the app mounts until approval", /<EnrollmentHold enforced=\{enrollmentEnforced\}>\s*<AppProviders>/.test(layout) && /<\/AppProviders>\s*<\/EnrollmentHold>/.test(layout));
assert("H2 the decision is made on the server, only for a signed-in caller, only when it is not the desktop app, and is read from the env-first config", /if \(user\) \{\s*try \{/.test(layout) && layout.indexOf("isDesktopShellUserAgent(ua)") > -1 && layout.indexOf("isDesktopShellUserAgent(ua)") < layout.indexOf("getEnrollmentConfig(user.tenantId)"));
assert("H3 a failure while deciding never holds the app (fail open, logged)", /catch \(e\) \{\s*console\.error\("\[device-enrollment\] layout check failed — not holding the app"/.test(layout) && /let enrollmentEnforced = false;/.test(layout));
assert("H4 a switched-off workspace renders its children untouched (no hook, no request)", /if \(!enforced\) return <>\{children\}<\/>;/.test(hold));
assert("H5 an approved device (or a workspace switched off meanwhile) gets the app; everything else gets only the request screen", /st && \(!st\.enforced \|\| st\.status === "approved"\)\) return <>\{children\}<\/>;/.test(hold) && /<EnrollmentGateCard gate=\{gate\} loading=\{st === null\} \/>/.test(hold));
assert("H6 the old always-mounted gate is gone from the provider tree", !/EnrollmentGate/.test(providers));
assert("H7 the request screen never reads the company's whole branch list — only the typed-name suggestions", !/["'`]\/api\/branches["'`?]/.test(gate) && /\/api\/devices\/enrollment\/branches\?q=/.test(gate));
assert("H8 the suggestions route needs a signed-in caller and returns only what the search returns (id / name / city)", /Unauthorized/.test(branchRoute) && /searchBranchesForEnrollment\(ws, q\)/.test(branchRoute));
assert("H9 the red circle shares ONE summary request (a number), is shown only on the Control Room tab, and the summary backs off to 10 minutes when the feature is off", /\/api\/control-room\/enrollments\/pending-count/.test(summary) && /600_000/.test(summary) && /useEnrollmentSummary/.test(dot) && !/fetch\(/.test(dot) && /item\.labelKey === "controlRoom" \? <EnrollmentPendingDot \/> : null/.test(shell));
assert("H10 the count route never touches the table for someone who decides nothing or while off (it uses countPendingForActor)", /countPendingForActor/.test(countRoute) && !/prisma/.test(countRoute));
assert("H11 the last approval is remembered for 10 minutes only, per device id, and anything but 'approved' clears it", /OK_MS = 10 \* 60_000/.test(hook) && /j\.id === id/.test(hook) && /removeItem\(OK_KEY\)/.test(hook));
assert("H12 a first answer that has not arrived is retried every 4 seconds, and a browser without storage is told so (never a blank screen)", /4_000/.test(hook) && /setNoStorage\(true\)/.test(hook));

assert("H13 the approvals card is no longer pinned above the Control Room page (owner 2026-10-28: it belongs in the branch list, like entering a branch)", !/DeviceEnrollmentPanel|device-enrollment-panel/.test(crPage));
assert("H14 'New requests' is the FIRST tile of the branch list, only for someone who may decide (or the main admin while it is off), and its count is the shared summary's", branchesView.indexOf("<EnrollmentTile") > -1 && branchesView.indexOf("<EnrollmentTile") < branchesView.indexOf("visibleRows.map((r) => (") && /s\.available && \(\(s\.enabled && s\.canDecide\) \|\| \(!s\.enabled && s\.isAdmin\)\)/.test(panel));
assert("H15 the requests screen opens in the list's place, a branch name opens that branch (map pins it) and Back from it returns to the requests; every other panel closes it", /<EnrollmentRequestsPanel onBack=\{\(\) => setRequestsOpen\(false\)\} onOpenBranch=\{\(id\) => \{ openBranch\(id\); setBackToRequests\(true\); \}\} \/>/.test(branchesView) && /if \(backToRequests\) \{ setRequestsOpen\(true\); setBackToRequests\(false\); \}/.test(branchesView) && (branchesView.match(/setRequestsOpen\(false\)/g) ?? []).length >= 7);
assert("H16 the branch screen lists the Players / Remotes of that branch (BranchDevices) before its jingles, and shows nothing while the feature is off", branchesView.indexOf("<BranchDevices") > -1 && branchesView.indexOf("<BranchDevices") < branchesView.indexOf("<BranchJingles") && /if \(!listing \|\| !listing\.config\.enabled\) return null;/.test(panel));

assert("H17 the requests screen shows ONLY requests (owner 2026-10-28): no approved-devices list and no '7 days' footer on it — the days and the off switch live in the quiet ⋯ menu, admin only", (() => { const a = panel.indexOf("export function EnrollmentRequestsPanel"); const b = panel.indexOf("export function BranchDevices"); const body = panel.slice(a, b); return !/cr-enr-approved|cr-enr-foot/.test(body) && /<SettingsMenu d=\{d\} \/>/.test(body) && /!listing\.actor\.isAdmin\) return null;/.test(panel); })());
assert("H18 switching approvals on keeps the admin's own screen what it is: a player stays a PLAYER (when a seat is free), anything else a Remote — decided from the screen's own role icon test", /ownDeviceRole: isPlayerNow \? "PLAYER" : "REMOTE"/.test(panel) && /ctx\.deviceMode === "MASTER" \|\| ctx\.isDesignatedAudioStation/.test(panel) && /seatFree = args\.ownDeviceRole === "PLAYER"/.test(read("lib/device-enrollment-store.ts")));

assert("H19 the request screen has no card and no frames (owner 2026-10-28): two soft squares, the chosen one grows, the other fades away; nothing is boxed in an outline", !/vono-enr-card/.test(gate + gateCss) && /\.vono-enr-tile\[data-state="on"\] \{ transform: scale\(1\.08\)/.test(gateCss) && /\.vono-enr-tile\[data-state="away"\] \{ width: 0;/.test(gateCss) && !/box-shadow: inset 0 0 0 \dpx/.test(gateCss));
assert("H20 the details follow the choice: a Player gets only the branch (+ address and brand for a NEW one) and sends no person; a Remote gives who he is and the existing branch it controls", /role === "REMOTE" \? \(\s*<>/.test(gate) && /firstName: role === "REMOTE" \? first\.trim\(\) : ""/.test(gate) && /branchAddress: picked \|\| role !== "PLAYER" \? "" : address\.trim\(\)/.test(gate) && /\{newBranch \? \(/.test(gate));
assert("H21 'I'm the owner' is the main admin's only: the route refuses everyone else (403), the status call tells ONLY an admin it exists, the bar shows only then, and the device is a Remote with no seat", /if \(!caller\.actor\.isAdmin\) return NextResponse\.json\(\{ error: "Forbidden" \}, \{ status: 403 \}\)/.test(ownerRoute) && /caller\.caller\.actor\.isAdmin\) return NextResponse\.json\(\{ \.\.\.pub, ownerAllowed: true \}/.test(statusRoute) && /st\.ownerAllowed === true/.test(gate) && /approvedRole: "REMOTE"/.test(read("lib/device-enrollment-store.ts")));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
