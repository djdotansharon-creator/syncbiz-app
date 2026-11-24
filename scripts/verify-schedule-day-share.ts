/**
 * SENDING ONE DAY OF A BRANCH'S SCHEDULE TO THE OTHER BRANCHES OF THE SAME BUSINESS — phase 1, the server (owner 2026-11-25). Three parts:
 *   A. the PURE rules (lib/schedule-day-share-rules.ts): what each block type does, local files never placed, closings, caps, conflict modes, past dates, wall-clock times, who may answer;
 *   B. the WIRING: only the store touches the table, the routes use the tenant fence + the rate limit and never import the engine, the migration is CREATE TABLE only, the Schedule model is unchanged;
 *   C. a DATABASE section against the LOCAL database (REFUSES anything but localhost): send → accept → rows with the stamp → accept twice applies once → foreign branch / playlist refused → undo removes
 *      only untouched rows and keeps an edited one → shares revoked → decline / revoke / date / alongside / caps.
 * Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-schedule-day-share.ts
 * (without a localhost DATABASE_URL, parts A and B still run and part C is skipped)
 */
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  DAY_SHARE_LIMITS,
  buildDaySnapshot,
  decideDayShareAction,
  decideSend,
  isUndoable,
  normTime,
  planApply,
  revalidateSnapshot,
  summarizeSnapshot,
  timeToMinutes,
  weekdayOfYmd,
  type DayBlockIn,
  type DaySnapshot,
  type TargetBlockIn,
  type TargetFacts,
} from "../lib/schedule-day-share-rules";
import { ymdOf } from "../lib/schedule-skip";

let pass = 0, fail = 0;
function assert(name: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${!cond && detail !== undefined ? "   -> " + JSON.stringify(detail) : ""}`);
  if (cond) pass++; else { fail++; process.exitCode = 1; }
}
const ROOT = path.join(__dirname, "..");
const rd = (p: string) => readFileSync(path.join(ROOT, p), "utf-8").replace(/\r\n/g, "\n");
const J = JSON.stringify;
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

// ───────────────────────────────────────────────────────── A. the pure rules ─────────────────────────────────────────────────────────

const facts: TargetFacts = {
  workspaceId: "WS",
  playlists: {
    web: { name: "Web mix", workspaceId: "WS", branchId: "SRC", hasLocalFiles: false, hasHttpPlayable: true },
    local: { name: "Disk mix", workspaceId: "WS", branchId: "SRC", hasLocalFiles: true, hasHttpPlayable: true }, // a MIXED playlist (some local file) is local too
    empty: { name: "Empty shell", workspaceId: "WS", branchId: "SRC", hasLocalFiles: false, hasHttpPlayable: false },
    foreign: { name: "SECRET OTHER BUSINESS", workspaceId: "OTHER", branchId: null, hasLocalFiles: false, hasHttpPlayable: true },
  },
  banks: { dance: { name: "Dance", open: true }, vip: { name: "VIP bank", open: false } },
};
const blk = (o: Partial<DayBlockIn> & { id: string }): DayBlockIn => ({ name: null, targetType: "PLAYLIST", targetId: "web", startTimeLocal: "09:00:00", endTimeLocal: "23:59:00", volume: null, priority: 1, enabled: true, recurrence: "weekly", daysOfWeek: [1], ...o });
const snap = (blocks: DayBlockIn[], weekday = 1) => buildDaySnapshot({ blocks, weekday, facts });
const reasonOf = (s: DaySnapshot, time: string) => s.skipped.find((x) => x.time === time)?.reason;

const matrix = snap([
  blk({ id: "1", startTimeLocal: "08:00", targetId: "web", name: "Morning", endTimeLocal: "12:00", volume: 40, priority: 2 }),
  blk({ id: "2", startTimeLocal: "09:00", targetId: "local" }),
  blk({ id: "3", startTimeLocal: "10:00", targetId: "empty" }),
  blk({ id: "4", startTimeLocal: "11:00", targetId: "foreign" }),
  blk({ id: "5", startTimeLocal: "12:00", targetId: "gone" }),
  blk({ id: "6", startTimeLocal: "13:00", targetType: "RADIO", targetId: "r1" }),
  blk({ id: "7", startTimeLocal: "14:00", targetType: "SOURCE", targetId: "s1" }),
  blk({ id: "8", startTimeLocal: "15:00", targetType: "BANK", targetId: "dance" }),
  blk({ id: "9", startTimeLocal: "16:00", targetType: "BANK", targetId: "vip" }),
  blk({ id: "10", startTimeLocal: "17:00", targetType: "BANK", targetId: "nope" }),
  blk({ id: "11", startTimeLocal: "18:00", targetType: "SILENCE", targetId: "silence", name: "Quiet" }),
  blk({ id: "12", startTimeLocal: "22:00", targetType: "SILENCE", targetId: "silence", name: "Closing" }),
  blk({ id: "13", startTimeLocal: "19:00", targetType: "ANNOUNCEMENT", targetId: "x" }),
]);
assert("R1 type matrix: a playlist of web addresses, a public / opened bank and a quiet block are PLACED; a playlist with a local file (even mixed), an empty shell, a foreign or missing playlist, a radio, a source, a closed / unknown bank, an unknown kind are LISTED as not placeable, each with its reason",
  J(matrix.blocks.map((b) => b.time)) === J(["08:00:00", "15:00:00", "18:00:00"]) &&
  reasonOf(matrix, "09:00:00") === "local-files" && reasonOf(matrix, "10:00:00") === "no-playable-url" && reasonOf(matrix, "11:00:00") === "not-this-business" && reasonOf(matrix, "12:00:00") === "gone" &&
  reasonOf(matrix, "13:00:00") === "radio" && reasonOf(matrix, "14:00:00") === "source" && reasonOf(matrix, "16:00:00") === "bank-not-open" && reasonOf(matrix, "17:00:00") === "bank-not-open" && reasonOf(matrix, "19:00:00") === "unsupported", matrix);
assert("R2 a day's numbers are 'N fit, M cannot be placed' (the kept Closing is counted apart)", J(summarizeSnapshot(matrix)) === J({ fits: 3, cannot: 9, kept: 1 }), summarizeSnapshot(matrix));
assert("R3 the sender's own 'Closing' blocks are NOT copied (the receiver keeps its own) but another quiet block IS copied", reasonOf(matrix, "22:00:00") === "closing-kept" && matrix.blocks.some((b) => b.target.type === "SILENCE" && b.target.id === "silence" && b.time === "18:00:00"));
assert("R4 a block copies its time, end, name, volume and priority; a playlist keeps its id and name", J(matrix.blocks[0]) === J({ time: "08:00:00", end: "12:00:00", name: "Morning", target: { type: "PLAYLIST", id: "web", name: "Web mix" }, volume: 40, priority: 2 }), matrix.blocks[0]);
const dayOnly = snap([
  blk({ id: "a", startTimeLocal: "10:00" }),
  blk({ id: "b", startTimeLocal: "08:00" }),
  blk({ id: "c", startTimeLocal: "11:00", enabled: false }),
  blk({ id: "d", startTimeLocal: "12:00", daysOfWeek: [2] }),
  blk({ id: "e", startTimeLocal: "13:00", recurrence: "one_off", daysOfWeek: [] }),
  blk({ id: "f", startTimeLocal: "07:00", daysOfWeek: [0, 1, 2] }),
]);
assert("R5 the day = the ENABLED WEEKLY blocks of that weekday, in time order (a paused block, another weekday's block and a one-off date are not part of it)", J(dayOnly.blocks.map((b) => b.time)) === J(["07:00:00", "08:00:00", "10:00:00"]), dayOnly.blocks);
const poisoned = snap([blk({ id: "p", targetId: "web" })]);
const poisonFacts: TargetFacts = { ...facts, playlists: { web: { ...facts.playlists.web!, url: "C:\\Music\\secret.mp3", path: "/home/x/secret.mp3", tracks: [{ url: "D:\\x.mp3" }] } as never } };
const poisonedOut = J(buildDaySnapshot({ blocks: [blk({ id: "p", targetId: "web" })], weekday: 1, facts: poisonFacts }));
assert("R6 CLAUDE.md §12: the snapshot is whitelisted — whatever else a playlist fact carries (a url, a path, tracks) never reaches it, and the playlist of ANOTHER business is not even named", !/secret|C:\\|D:\\|\/home/.test(poisonedOut) && J(poisoned) === J(buildDaySnapshot({ blocks: [blk({ id: "p", targetId: "web" })], weekday: 1, facts })) && !J(matrix).includes("SECRET OTHER BUSINESS"));

// applying
const NOW = new Date(2026, 10, 25, 12, 0, 0); // Wed 2026-11-25, local
const full = snap([
  blk({ id: "m", startTimeLocal: "08:00", name: "Morning", volume: 40, priority: 2, endTimeLocal: "12:00" }),
  blk({ id: "q", startTimeLocal: "15:00", targetType: "SILENCE", targetId: "silence", name: "Quiet" }),
  blk({ id: "l", startTimeLocal: "22:30", name: "Late" }),
]);
const tb = (o: Partial<TargetBlockIn> & { id: string }): TargetBlockIn => ({ name: null, targetType: "PLAYLIST", startTimeLocal: "09:00:00", enabled: true, recurrence: "weekly", daysOfWeek: [1], oneOffDateLocal: null, skipDates: [], ...o });
const own = [tb({ id: "own", name: "Own", startTimeLocal: "08:30:00", daysOfWeek: [1, 2] }), tb({ id: "solo", name: "Solo", startTimeLocal: "12:30:00", daysOfWeek: [1] }), tb({ id: "close", name: "Closing", targetType: "SILENCE", startTimeLocal: "22:00:00", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }), tb({ id: "sat", name: "Sat", daysOfWeek: [6] })];
const wk = planApply({ snapshot: full, input: { mode: "weekday", weekdays: [1] }, target: own, now: NOW });
assert("R7 'Replace that day' for a weekly routine: the branch's own blocks LOSE that weekday (disabled when none is left, never deleted); its Closing and other weekdays stay; a block after its closing is listed and skipped",
  wk.ok && J(wk.edits) === J([{ id: "own", kind: "remove-weekdays", days: [1], disable: false }, { id: "solo", kind: "remove-weekdays", days: [1], disable: true }]) && wk.rows.length === 2 && wk.skipped.some((s) => s.reason === "after-closing" && s.time === "22:30:00") && !wk.edits.some((e) => e.id === "close" || e.id === "sat"), wk);
assert("R8 the copied rows are weekly on the chosen weekday and carry time / end / name / volume / priority exactly — and set NO timezone (the engine uses the player's own clock)",
  wk.ok && J(wk.rows[0]) === J({ name: "Morning", targetType: "PLAYLIST", targetId: "web", startTimeLocal: "08:00:00", endTimeLocal: "12:00:00", volume: 40, priority: 2, recurrence: "weekly", daysOfWeek: [1], oneOffDateLocal: null }) && wk.rows.every((r) => !("timezone" in r) && !("timeZone" in r)), wk.ok ? wk.rows[0] : wk);
const tomorrow = ymdOf(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 1));
const todayYmd = ymdOf(NOW);
const dt = planApply({ snapshot: full, input: { mode: "date", date: tomorrow }, target: own.map((b) => ({ ...b, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })), now: NOW });
assert("R9 'Replace that day' for a date: each active block of the branch that runs that day gets a skip-date (the Closing is kept); the copies are one-off blocks on that date with no weekday list",
  dt.ok && dt.edits.every((e) => e.kind === "skip-date" && e.date === tomorrow) && J(dt.edits.map((e) => e.id).sort()) === J(["own", "sat", "solo"]) && dt.rows.every((r) => r.recurrence === "one_off" && r.oneOffDateLocal === tomorrow && r.daysOfWeek.length === 0), dt);
const past = planApply({ snapshot: full, input: { mode: "date", date: "2020-01-01" }, target: own, now: NOW });
const yesterday = ymdOf(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 1));
const twoAgo = ymdOf(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - 2));
assert("R10 a PAST date is refused (400); a margin of one day covers the branch's own clock; a malformed date / weekday / mode is refused",
  !past.ok && past.status === 400 && planApply({ snapshot: full, input: { mode: "date", date: twoAgo }, target: own, now: NOW }).ok === false && planApply({ snapshot: full, input: { mode: "date", date: yesterday }, target: own, now: NOW }).ok &&
  !planApply({ snapshot: full, input: { mode: "date", date: "2026-02-30" }, target: own, now: NOW }).ok && !planApply({ snapshot: full, input: { mode: "weekday", weekdays: [7] }, target: own, now: NOW }).ok && !planApply({ snapshot: full, input: { mode: "weekday", weekdays: [] }, target: own, now: NOW }).ok && !planApply({ snapshot: full, input: { mode: "x" as never }, target: own, now: NOW }).ok);
const todayPlan = planApply({ snapshot: full, input: { mode: "date", date: todayYmd }, target: own, now: NOW });
const todayWeekly = planApply({ snapshot: full, input: { mode: "weekday", weekdays: [NOW.getDay()] }, target: own, now: NOW });
assert("R11 applying to TODAY is allowed, with a warning (a date today, or a routine that includes today's weekday); another day has none", todayPlan.ok && todayPlan.warnings.length === 1 && todayWeekly.ok && todayWeekly.warnings.length === 1 && dt.ok && dt.warnings.length === 0 && wk.ok && wk.warnings.length === 0);
const alongside = planApply({ snapshot: full, input: { mode: "weekday", weekdays: [1], conflict: "alongside" }, target: [tb({ id: "tie", name: "Tie", startTimeLocal: "08:00:00", daysOfWeek: [1] }), ...own], now: NOW });
assert("R12 'alongside' changes NOTHING of the branch's own blocks and only flags a block that starts in the same minute", alongside.ok && alongside.edits.length === 0 && J(alongside.conflicts.map((c) => [c.id, c.kind])) === J([["tie", "tie"]]), alongside);
const nothing = planApply({ snapshot: { v: 1, weekday: 1, blocks: [], skipped: [] }, input: { mode: "weekday" }, target: own, now: NOW });
assert("R13 an offer with nothing that can be placed is refused (422) and nothing is replaced", !nothing.ok && nothing.status === 422);
const night = planApply({ snapshot: full, input: { mode: "weekday", weekdays: [1] }, target: [tb({ id: "n1", startTimeLocal: "18:00:00", daysOfWeek: [1] }), tb({ id: "nc", name: "Closing", targetType: "SILENCE", startTimeLocal: "02:00:00", daysOfWeek: [1] })], now: NOW });
assert("R14 a 'Closing' that ends yesterday's evening (02:00, before the branch opens) is not a cut: the whole day is placed; with no closing at all nothing is cut", night.ok && night.rows.length === 3 && planApply({ snapshot: full, input: { mode: "weekday", weekdays: [1] }, target: [], now: NOW }).ok);
const multi = planApply({ snapshot: full, input: { mode: "weekday", weekdays: [1, 2] }, target: [tb({ id: "o", startTimeLocal: "08:30:00", daysOfWeek: [1, 2] }), tb({ id: "c1", name: "Closing", targetType: "SILENCE", startTimeLocal: "22:00:00", daysOfWeek: [1] })], now: NOW });
assert("R15 with several weekdays a block is placed only on the weekdays where it is BEFORE the closing, and the weekdays left out are listed", multi.ok && J(multi.rows.find((r) => r.name === "Late")?.daysOfWeek) === J([2]) && J(multi.skipped.find((s) => s.reason === "after-closing")?.days) === J([1]), multi);
const rv = revalidateSnapshot(full, { ...facts, playlists: { web: { ...facts.playlists.web!, hasLocalFiles: true } } });
assert("R16 before applying, the offer is looked at again: a playlist that gained a local file / vanished moves to the skipped list with its reason (nothing is lost silently), a quiet block stays", rv.blocks.length === 1 && rv.blocks[0]!.target.type === "SILENCE" && rv.skipped.filter((s) => s.reason === "local-files").length === 2 && J(revalidateSnapshot(full, { ...facts, playlists: {} }).skipped.map((s) => s.reason)) === J(["gone", "gone"]));

// caps
const t = (n: number) => Array.from({ length: n }, (_, k) => `B${k}`);
const sendOk = decideSend({ targets: ["A", "B"], skipped: [], blockCount: 10, fitCount: 3, pendingByTarget: { A: 19, B: 20 } });
assert("R17 caps: ≤ 50 target branches (413), ≤ 200 blocks (413), ≤ 20 PENDING per target branch (that branch is skipped and listed, the others still go), something must fit, someone must receive it",
  !decideSend({ targets: t(51), skipped: [], blockCount: 1, fitCount: 1, pendingByTarget: {} }).ok && decideSend({ targets: t(50), skipped: [], blockCount: 1, fitCount: 1, pendingByTarget: {} }).ok &&
  (decideSend({ targets: ["A"], skipped: [], blockCount: 201, fitCount: 1, pendingByTarget: {} }) as { status?: number }).status === 413 && decideSend({ targets: ["A"], skipped: [], blockCount: 200, fitCount: 1, pendingByTarget: {} }).ok &&
  sendOk.ok && J(sendOk.targets) === J(["A"]) && J(sendOk.skipped) === J([{ branchId: "B", reason: "too-many-waiting" }]) &&
  !decideSend({ targets: ["A"], skipped: [], blockCount: 5, fitCount: 0, pendingByTarget: {} }).ok && !decideSend({ targets: ["A"], skipped: [], blockCount: 5, fitCount: 2, pendingByTarget: { A: 20 } }).ok &&
  DAY_SHARE_LIMITS.SENDS_PER_HOUR === 10 && DAY_SHARE_LIMITS.MAX_TARGET_BRANCHES === 50 && DAY_SHARE_LIMITS.MAX_BLOCKS === 200 && DAY_SHARE_LIMITS.MAX_PENDING_PER_TARGET === 20 && DAY_SHARE_LIMITS.UNDO_DAYS === 14);

// who may do what
const base = { isSender: false, canUseTarget: true, expired: false, undoable: true };
const dd = (current: "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "UNDONE", action: "accept" | "decline" | "revoke" | "undo" | "preview", o: Partial<typeof base> = {}) => decideDayShareAction({ current, action, ...base, ...o });
assert("R18 the receiving branch decides: accept / decline / preview a PENDING offer; an answer is given once (409); an expired offer cannot be accepted (410); someone who may not use the branch is refused (403)",
  J(dd("PENDING", "accept")) === J({ ok: true, status: "ACCEPTED" }) && J(dd("PENDING", "decline")) === J({ ok: true, status: "DECLINED" }) && J(dd("PENDING", "preview")) === J({ ok: true, status: "PENDING" }) &&
  !dd("ACCEPTED", "accept").ok && !dd("DECLINED", "accept").ok && !dd("ACCEPTED", "decline").ok && dd("PENDING", "accept", { expired: true }).ok === false && (dd("PENDING", "accept", { expired: true }) as { status?: number }).status === 410 &&
  (dd("PENDING", "accept", { canUseTarget: false }) as { status?: number }).status === 403 && (dd("ACCEPTED", "undo", { canUseTarget: false }) as { status?: number }).status === 403);
assert("R19 only the SENDER takes a PENDING offer back; an accepted one is undone by the branch (14 days), not revoked; a revoked offer answers 409 to everything",
  J(dd("PENDING", "revoke", { isSender: true, canUseTarget: false })) === J({ ok: true, status: "REVOKED" }) && (dd("PENDING", "revoke") as { status?: number }).status === 403 && !dd("ACCEPTED", "revoke", { isSender: true }).ok && !dd("DECLINED", "revoke", { isSender: true }).ok &&
  J(dd("ACCEPTED", "undo")) === J({ ok: true, status: "UNDONE" }) && !dd("ACCEPTED", "undo", { undoable: false }).ok && !dd("PENDING", "undo").ok && !dd("UNDONE", "undo").ok && !dd("REVOKED", "accept").ok);
const dec = new Date("2026-11-01T10:00:00Z");
assert("R20 the undo window is 14 days from the moment of accepting", isUndoable(dec, new Date(dec.getTime() + 14 * 86400000)) && !isUndoable(dec, new Date(dec.getTime() + 14 * 86400000 + 1)) && !isUndoable(null, dec));
assert("R21 time helpers: wall-clock text is kept; weekday of a date is built from its parts (no time zone)", timeToMinutes("08:05:30") === 485 && timeToMinutes("24:00") === null && normTime("8:05", "x") === "08:05:00" && normTime("bad", "23:59:00") === "23:59:00" && weekdayOfYmd("2026-11-25") === 3);

// ───────────────────────────────────────────────────────── B. the wiring ─────────────────────────────────────────────────────────

function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(path.join(ROOT, dir))) {
    if (["node_modules", ".next", ".git", ".claude", "dist", "out"].includes(n)) continue;
    const rel = path.join(dir, n);
    const st = statSync(path.join(ROOT, rel));
    if (st.isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx|mjs|cjs|js)$/.test(n)) out.push(rel);
  }
  return out;
}
const sources = ["lib", "app", "components", "server", "desktop/src"].flatMap((d) => { try { return walk(d); } catch { return []; } });
const touchers = sources.filter((f) => /\bscheduleDayShare\b|"ScheduleDayShare"/.test(rd(f)));
assert("W1 the store is the ONLY file that touches the ScheduleDayShare table (no route, rule, component, server or desktop file reads or writes it)", J(touchers) === J(["lib/schedule-day-share-store.ts"]), touchers);

const rules = rd("lib/schedule-day-share-rules.ts");
const store = rd("lib/schedule-day-share-store.ts");
const rSend = rd("app/api/schedule-day-shares/route.ts");
const rPrev = rd("app/api/schedule-day-shares/preview/route.ts");
const rAns = rd("app/api/schedule-day-shares/[id]/route.ts");
assert("W2 the rules are pure: no prisma / store / fetch / Date.now / new Date() with no argument (the caller passes `now`)", !/prisma|fetch\(|Date\.now\(|new Date\(\)/.test(code(rules)) && !/from "@\/lib\/(store|prisma)|from "\.\/(store|prisma)/.test(rules));
assert("W3 every route: signed-in (401), tenant context (400), the rate limit, and answers only inside the caller's business", [rSend, rPrev, rAns].every((r) => /status: 401/.test(r) && /Tenant context missing/.test(r) && /allowHit\(/.test(r) && /getCurrentUserFromCookies\(\)/.test(r)));
assert("W4 sending: only an OWNER, only from a branch the caller may use, targets only inside the business and the caller's access (the store picks them), idempotent by requestId, 10 sends an hour, shadow-authorised", /getAccessType\(user\.id, tenantId\)\) !== "OWNER"/.test(rSend) && /hasBranchAccess\(user\.id, fromBranchId, tenantId\)/.test(rSend) && /getAssignedBranchIdsForUser\(user\.id, tenantId\)/.test(rSend) && /REQUEST_ID\.test\(b\.requestId\)/.test(rSend) && /allowHit\(`schedule-day-send:\$\{user\.id\}`, DAY_SHARE_LIMITS\.SENDS_PER_HOUR/.test(rSend) && /shadowAuthorize\(/.test(rSend) && /OWNER/.test(rPrev) && /previewSend\(/.test(rPrev) && !/sendOffers|answerOffer/.test(rPrev));
assert("W5 answering: the offer is found only in the caller's business (404), the caller must be able to use the RECEIVING branch, the action is validated, the date / weekdays are validated, accept and undo refresh /schedules", /getOfferInWorkspace\(tenantId, id\)/.test(rAns) && /hasBranchAccess\(user\.id, offer\.targetBranchId, tenantId\)/.test(rAns) && /ACTIONS\.includes\(action\)/.test(rAns) && /isYmd\(b\.date\)/.test(rAns) && /revalidatePath\("\/schedules"\)/.test(rAns) && /answerOffer\(\{ workspaceId: tenantId/.test(rAns));
const engineFiles = /lib\/schedule-(window|actions|auto-player|target-validator|playback-client)|schedule-auto-player/;
assert("W6 nothing here imports the schedule ENGINE (schedule-window / -actions / -auto-player / -target-validator / -playback-client) — the engine is untouched", [rules, store, rSend, rPrev, rAns].every((s) => !engineFiles.test(s.split("\n").filter((l) => /^\s*import\b|from "/.test(l)).join("\n"))));
assert("W7 the rows an accept creates are made by a DEDICATED write — createMany with preset ids, the 'day-copy' stamp, NO timezone — never store.addSchedule (which upserts a junk Branch row) and never a Branch upsert", /tx\.schedule\.createMany/.test(store) && /id: ids\[n\]!/.test(store) && /dayCopyTag\(batchId\)/.test(store) && !/addSchedule|db\.|branch\.upsert|branch\.create/.test(code(store)) && !/timezone/.test(code(store).replace(/\/\/ NO timezone[^\n]*/, "")));
assert("W8 ONE transaction for an accept (status compare-and-set WHERE status = PENDING, the new rows, the changes to the branch's own blocks, the shares, the ledger, the audit row); the status is changed before anything else is written", /\$transaction\(\s*async \(tx\) => \{/.test(store) && /where: \{ id: offer\.id, workspaceId, status: "PENDING", expiresAt: \{ gt: now \} \}/.test(store) && store.indexOf('id: offer.id, workspaceId, status: "PENDING", expiresAt: { gt: now } }') > 0 && store.indexOf('id: offer.id, workspaceId, status: "PENDING", expiresAt: { gt: now } }') < store.indexOf("tx.schedule.createMany") && store.indexOf("tx.schedule.createMany") < store.indexOf("createAcceptedBranchSharesTx(tx") && store.indexOf("createAcceptedBranchSharesTx(tx") < store.indexOf("ledger: ledger as unknown as"));
assert("W9 UNDO never throws data away: a created row is deleted only when updatedAt still equals the ledger value, a changed block is restored only when its updatedAt still equals what the accept left, only the shares THIS batch made are revoked", /tx\.schedule\.deleteMany\(\{ where: \{ id: c\.id, workspaceId, branchId: offer\.targetBranchId, updatedAt: new Date\(c\.updatedAt\) \}/.test(store) && /where: \{ id: t\.id, workspaceId, updatedAt: new Date\(t\.afterUpdatedAt\) \}/.test(store) && /revokeSharesByIdsTx\(tx, \{ workspaceId, shareIds: revokeIds \}\)/.test(store) && /ledger\.sharesCreated\.filter/.test(store) && !/schedule\.delete\(/.test(store));
assert("W10 tenant fences: every playlist / bank is checked against the business (a playlist of another business is only looked at for its owner), both branches are looked up WITH the workspace, the source day is the EXACT canonical-branch match (not schedulesForBranch)", /owner\.workspaceId !== workspaceId/.test(store) && /branch\.findFirst\(\{ where: \{ id, workspaceId \}/.test(store) && /branch\.findFirst\(\{ where: \{ id: offer\.targetBranchId, workspaceId \}/.test(store) && /legacyBranchEquivalents\(branchId, canonical\)/.test(store) && !/schedulesForBranch/.test(code(store)) && /p\.workspaceId !== facts\.workspaceId/.test(rules) && /createAcceptedBranchSharesTx/.test(store) && /workspaceId: i\.workspaceId \}, select/.test(rd("lib/playlist-share-store.ts")));
const audit = rd("lib/admin/tenant-audit.ts");
assert("W11 every send / answer / revoke / undo writes an audit row (inside the transaction) with the new actions and entity", ["schedule_day_share.send", "schedule_day_share.answer", "schedule_day_share.revoke", "schedule_day_share.undo"].every((a) => (audit.match(new RegExp(`"${a.replace(".", "\\.")}"`, "g")) ?? []).length === 2 && new RegExp(`action: "${a.replace(".", "\\.")}"|"${a.replace(".", "\\.")}"`).test(store)) && /"schedule_day_share"/.test(audit) && (store.match(/writeTenantAuditLog\(tx,/g) ?? []).length >= 4);
const mig = rd("prisma/migrations/20261125120000_schedule_day_share/migration.sql");
const stmts = mig.split("\n").filter((l) => !l.startsWith("--") && l.trim() !== "");
assert("W12 the migration is CREATE TABLE only: one new table + its own indexes and foreign keys; no DROP / DELETE / UPDATE / INSERT / TRUNCATE, no new enum, no ALTER of any existing table", /^CREATE TABLE "ScheduleDayShare"/m.test(mig) && !/\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|CREATE TYPE)\b/i.test(mig.replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL|RESTRICT|NO ACTION)/g, "")) && (mig.match(/ALTER TABLE "([A-Za-z]+)"/g) ?? []).every((a) => a === 'ALTER TABLE "ScheduleDayShare"') && (mig.match(/CREATE (UNIQUE )?INDEX [^\n]+ ON "([A-Za-z]+)"/g) ?? []).every((l) => l.includes('ON "ScheduleDayShare"')) && stmts.length > 10);
const schema = rd("prisma/schema.prisma");
const scheduleModel = schema.match(/\nmodel Schedule \{([\s\S]*?)\n\}/)![1]!;
const fields = scheduleModel.split("\n").map((l) => l.trim().split(/\s+/)[0]!).filter((x) => x && !x.startsWith("///") && !x.startsWith("@@"));
assert("W13 the Schedule model is UNCHANGED — no column was added to it (the copies are marked by a tag in its existing tags column)", J(fields) === J(["id", "workspaceId", "branchId", "playlistId", "name", "cronExpr", "timezone", "status", "targetType", "targetId", "sourceId", "deviceId", "recurrence", "oneOffDateLocal", "daysOfWeek", "startTimeLocal", "endTimeLocal", "enabled", "priority", "requestedStartPosition", "requestedEndPosition", "volume", "createdBy", "updatedBy", "taxonomyTags", "startDate", "endDate", "createdAt", "updatedAt", "workspace", "branch", "playlist"]), fields);
assert("W14 the offer table has the decided columns (requestId UNIQUE; a snapshot and a ledger as JSON; applied mode / weekdays / date; created / decided / undone / expires) and its indexes", /requestId\s+String\s+@unique/.test(schema) && /snapshot\s+Json\n/.test(schema) && /ledger\s+Json\?/.test(schema) && /appliedMode\s+String\?/.test(schema) && /appliedWeekdays\s+Int\[\]/.test(schema) && /undoneAt\s+DateTime\?/.test(schema) && /expiresAt\s+DateTime\n/.test(schema) && /@@index\(\[targetBranchId, status\]\)/.test(schema) && /@@index\(\[workspaceId\]\)/.test(schema));

// ───────────────────────────────────────────────────────── C. the local database ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Rec = Record<string, any>;

async function db(): Promise<void> {
  const { prisma } = await import("../lib/prisma");
  const store = await import("../lib/schedule-day-share-store");
  const { POC_MUSIC_BANK_CATALOG } = await import("../lib/music-bank/poc-catalog");
  const bankId = POC_MUSIC_BANK_CATALOG.genres[0]!.id;
  const tag = randomUUID().slice(0, 8);
  const mkUser = (n: string) => prisma.user.create({ data: { email: `${n}-${tag}@example.test`, name: `Person ${n}`, role: "CONTROLLER" } });
  const owner = await mkUser("owner");
  const staff = await mkUser("staff");
  const ownerB = await mkUser("ownerb");
  const ws = await prisma.workspace.create({ data: { name: `DayShare ${tag}`, slug: `dayshare-${tag}`, ownerId: owner.id } });
  const wsB = await prisma.workspace.create({ data: { name: `DayShare other ${tag}`, slug: `dayshare-other-${tag}`, ownerId: ownerB.id } });
  const mkBranch = (workspaceId: string, name: string) => prisma.branch.create({ data: { workspaceId, name, code: name.slice(0, 6).toUpperCase() } });
  const src = await mkBranch(ws.id, "Source");
  const [t1, t2, t3, t4, t5] = [await mkBranch(ws.id, "T1"), await mkBranch(ws.id, "T2"), await mkBranch(ws.id, "T3"), await mkBranch(ws.id, "T4"), await mkBranch(ws.id, "T5")];
  const bx = await mkBranch(wsB.id, "Foreign");
  const mkPlaylist = (workspaceId: string, name: string, branchId: string | null, local: boolean) =>
    prisma.playlist.create({
      data: {
        workspaceId, name, branchId, playlistType: local ? "local" : "youtube", url: local ? "" : "https://www.youtube.com/watch?v=abc",
        items: { create: [{ trackId: "t1", name: "Song", trackType: local ? "local" : "youtube", url: local ? "C:\\SECRET-DISK\\song.mp3" : "https://www.youtube.com/watch?v=abc", position: 0 }] },
      },
    });
  const pWeb = await mkPlaylist(ws.id, "Web mix", src.id, false);
  const pLocal = await mkPlaylist(ws.id, "Disk mix", src.id, true);
  const pForeign = await mkPlaylist(wsB.id, "Foreign mix", null, false);
  const sch = (branchId: string, o: Rec) => prisma.schedule.create({ data: { workspaceId: ws.id, branchId, recurrence: "weekly", daysOfWeek: [1], startTimeLocal: "09:00:00", endTimeLocal: "23:59:00", enabled: true, priority: 1, targetType: "PLAYLIST", targetId: pWeb.id, ...o } });
  const ALL = [0, 1, 2, 3, 4, 5, 6];
  // the source day (Monday)
  await sch(src.id, { name: "Morning", startTimeLocal: "08:00:00", endTimeLocal: "12:00:00", volume: 40, priority: 2, daysOfWeek: [1, 2] });
  await sch(src.id, { name: "Local mix", startTimeLocal: "10:00:00", targetId: pLocal.id });
  await sch(src.id, { name: "Radio", startTimeLocal: "11:00:00", targetType: "RADIO", targetId: "radio-1" });
  await sch(src.id, { name: "Src", startTimeLocal: "12:00:00", targetType: "SOURCE", targetId: "src-1" });
  await sch(src.id, { name: "Foreign", startTimeLocal: "13:00:00", targetId: pForeign.id });
  await sch(src.id, { name: "Bank", startTimeLocal: "14:00:00", targetType: "BANK", targetId: bankId, volume: 25 });
  await sch(src.id, { name: "Quiet", startTimeLocal: "15:00:00", targetType: "SILENCE", targetId: "silence" });
  await sch(src.id, { name: "Late", startTimeLocal: "22:30:00" });
  await sch(src.id, { name: "Closing", startTimeLocal: "22:00:00", targetType: "SILENCE", targetId: "silence", daysOfWeek: ALL });
  await sch(src.id, { name: "Off", startTimeLocal: "16:00:00", enabled: false });
  await sch(src.id, { name: "Tue", startTimeLocal: "09:00:00", daysOfWeek: [2] });
  await sch(src.id, { name: "OneOff", startTimeLocal: "17:00:00", recurrence: "one_off", oneOffDateLocal: "2030-01-01", daysOfWeek: [] });
  // the receivers' own blocks
  const own1 = await sch(t1.id, { name: "T1 own", startTimeLocal: "08:30:00", daysOfWeek: [1, 2] });
  const solo1 = await sch(t1.id, { name: "T1 solo", startTimeLocal: "12:30:00", daysOfWeek: [1] });
  const close1 = await sch(t1.id, { name: "Closing", startTimeLocal: "22:00:00", targetType: "SILENCE", targetId: "silence", daysOfWeek: [1] });
  const sat1 = await sch(t1.id, { name: "T1 sat", daysOfWeek: [6] });
  const own2 = await sch(t2.id, { name: "T2 own", startTimeLocal: "09:00:00", daysOfWeek: [1, 2] });
  const other2 = await sch(t2.id, { name: "Other", startTimeLocal: "05:00:00", daysOfWeek: [1] }); // a MONDAY block of ANOTHER branch must not be in the source day
  const own3 = await sch(t3.id, { name: "T3 own", startTimeLocal: "08:00:00", daysOfWeek: ALL });
  await sch(t3.id, { name: "Closing", startTimeLocal: "22:00:00", targetType: "SILENCE", targetId: "silence", daysOfWeek: ALL });
  const wkApply = { mode: "weekday" as const, weekdays: [1] };
  const send = (o: Rec = {}) => store.sendOffers({ workspaceId: ws.id, userId: owner.id, fromBranchId: src.id, weekday: 1, requested: [t1.id, t2.id], access: ["*"], requestId: `req-${randomUUID()}`, ...o } as never) as Promise<Rec>;
  const answer = (offerId: string, action: string, o: Rec = {}) => store.answerOffer({ workspaceId: ws.id, userId: owner.id, offerId, action, canUseTarget: true, apply: wkApply, ...o } as never) as Promise<Rec>;
  const schedulesOf = (branchId: string) => prisma.schedule.findMany({ where: { branchId }, orderBy: { startTimeLocal: "asc" } });
  const stamped = <T extends { taxonomyTags: unknown }>(rows: T[]): T[] => rows.filter((r) => Array.isArray(r.taxonomyTags) && (r.taxonomyTags as Rec[]).some((x) => x.key === "day-copy"));
  const mkOffer = (o: Rec) => prisma.scheduleDayShare.create({ data: { workspaceId: ws.id, fromBranchId: src.id, targetBranchId: t5.id, fromUserId: owner.id, sourceWeekday: 1, requestId: `ins-${randomUUID()}`, snapshot: { v: 1, weekday: 1, blocks: [], skipped: [] }, expiresAt: new Date(Date.now() + 86400000), ...o } });

  try {
    // ── preview + send
    const pv = (await store.previewSend({ workspaceId: ws.id, fromBranchId: src.id, weekday: 1, requested: "all", access: ["*"] })) as Rec;
    const before = await prisma.scheduleDayShare.count({ where: { workspaceId: ws.id } });
    assert("D1 PREVIEW: '4 fit, 4 cannot be placed' with the reasons, the sender's Closing kept apart, the source day is ONLY the source branch's own Monday blocks (a Monday block of another branch, a paused one, Tuesday's and a one-off date are not in it), 'all' = every other branch of the business; it writes nothing",
      pv.ok && J(pv.summary) === J({ fits: 4, cannot: 4, kept: 1 }) && J(pv.blocks.map((b: Rec) => b.name)) === J(["Morning", "Bank", "Quiet", "Late"]) &&
      J(pv.skipped.map((s: Rec) => s.reason).sort()) === J(["closing-kept", "local-files", "not-this-business", "radio", "source"]) &&
      J([...pv.targets].sort()) === J([t1.id, t2.id, t3.id, t4.id, t5.id].sort()) && (await prisma.scheduleDayShare.count({ where: { workspaceId: ws.id } })) === before, pv);
    assert("D2 PREVIEW is fenced: a branch of ANOTHER business as the source → 404; as a target it is skipped 'not-a-branch-of-this-business'; the source itself is skipped 'own-branch'; a branch the caller may not use is skipped 'no-access'",
      (await store.previewSend({ workspaceId: ws.id, fromBranchId: bx.id, weekday: 1, requested: "all", access: ["*"] }) as Rec).status === 404 &&
      J(((await store.previewSend({ workspaceId: ws.id, fromBranchId: src.id, weekday: 1, requested: [t1.id, t2.id, src.id, bx.id], access: [t1.id] })) as Rec).skippedTargets.map((s: Rec) => [s.branchId, s.reason]).sort()) === J([[bx.id, "not-a-branch-of-this-business"], [src.id, "own-branch"], [t2.id, "no-access"]].sort()));

    const o = await send({ requested: [t1.id, t2.id, bx.id], requestId: `same-${tag}` });
    const O1 = o.created.find((x: Rec) => x.targetBranchId === t1.id);
    const O2 = o.created.find((x: Rec) => x.targetBranchId === t2.id);
    assert("D3 SEND: one PENDING offer per receiving branch of the business (the foreign branch is skipped and listed), the offer carries the day as a WHITELISTED snapshot (no ledger, no local path, nothing of the foreign playlist), and nothing changed in the receivers' schedules",
      o.ok && o.created.length === 2 && o.created.every((x: Rec) => x.status === "PENDING" && x.summary.fits === 4 && x.fromUserId === owner.id) && o.skippedTargets.some((s: Rec) => s.branchId === bx.id) &&
      !/SECRET-DISK|ledger|Foreign mix/.test(J(o.created)) && (await schedulesOf(t1.id)).length === 4 && (await schedulesOf(t2.id)).length === 2 && (await schedulesOf(bx.id)).length === 0, o);
    const again = await send({ requested: [t1.id, t2.id], requestId: `same-${tag}` });
    assert("D4 IDEMPOTENT: the same requestId again (a retry / double click) sends nothing new — it answers with the offers it already made", again.ok && again.created.length === 0 && again.alreadySent.length === 2 && (await prisma.scheduleDayShare.count({ where: { workspaceId: ws.id, targetBranchId: { in: [t1.id, t2.id] } } })) === 2);

    // ── tampered offers: a foreign branch, a foreign playlist, an expired one
    const oForeignBranch = await mkOffer({ targetBranchId: bx.id, snapshot: { v: 1, weekday: 1, blocks: [{ time: "08:00:00", end: "09:00:00", name: "x", target: { type: "SILENCE", id: "silence", name: "Quiet" }, volume: null, priority: 1 }], skipped: [] } });
    const rFB = await answer(oForeignBranch.id, "accept");
    const oForeignPl = await mkOffer({ targetBranchId: t5.id, snapshot: { v: 1, weekday: 1, blocks: [{ time: "08:00:00", end: "09:00:00", name: "Foreign", target: { type: "PLAYLIST", id: pForeign.id, name: "Foreign mix" }, volume: null, priority: 1 }, { time: "10:00:00", end: "11:00:00", name: "Quiet", target: { type: "SILENCE", id: "silence", name: "Quiet" }, volume: null, priority: 1 }], skipped: [] } });
    const rFP = await answer(oForeignPl.id, "accept", { apply: { mode: "weekday", weekdays: [3] } });
    const oExpired = await mkOffer({ targetBranchId: t5.id, expiresAt: new Date(Date.now() - 1000) });
    assert("D5 FOREIGN branch: an offer whose receiving branch belongs to another business is refused (404) and creates nothing; an offer of ANOTHER business is a 404 to the caller; FOREIGN playlist: a block that plays a playlist of another business is skipped 'not-this-business' (never placed, never shared), the rest still is",
      rFB.status === 404 && (await schedulesOf(bx.id)).length === 0 && (await answer(O1.id, "accept", { workspaceId: wsB.id })).status === 404 &&
      rFP.ok && rFP.result.created.length === 1 && rFP.result.skipped.some((s: Rec) => s.reason === "not-this-business") && (await schedulesOf(t5.id)).every((s) => s.targetId !== pForeign.id) && (await prisma.playlistShare.count({ where: { playlistId: pForeign.id } })) === 0, { rFB, rFP });
    const ex = await answer(oExpired.id, "accept");
    assert("D6 an EXPIRED offer cannot be accepted (410) and is not listed as pending", ex.status === 410 && !(await store.listOffers({ workspaceId: ws.id, branchIds: [t5.id], statuses: ["PENDING"] })).some((v) => v.id === oExpired.id));

    // ── accept O1 (weekday Monday, replace)
    const denied = await answer(O1.id, "accept", { canUseTarget: false });
    const pre = await answer(O1.id, "preview");
    const noDec = await prisma.scheduleDayShare.findUnique({ where: { id: O1.id } });
    assert("D7 a person who may NOT use the receiving branch is refused (403); PREVIEW shows what would happen (3 placed, Late skipped after the closing, 2 replaced) and writes nothing",
      denied.status === 403 && pre.ok && pre.preview.willPlace.length === 3 && pre.preview.skipped.some((s: Rec) => s.reason === "after-closing") && pre.preview.replaced.length === 2 && noDec?.status === "PENDING" && (await schedulesOf(t1.id)).length === 4, { denied, pre });
    const acc = await answer(O1.id, "accept");
    const t1rows = await schedulesOf(t1.id);
    const copies1 = stamped(t1rows);
    const row = (n: string) => t1rows.find((r) => r.name === n)!;
    const offerRow = await prisma.scheduleDayShare.findUnique({ where: { id: O1.id } });
    const share1 = await prisma.playlistShare.findMany({ where: { playlistId: pWeb.id, targetBranchId: t1.id } });
    assert("D8 ACCEPT (a weekly routine on Monday): 3 rows are created on the receiver — Morning / Bank / Quiet — weekly, Monday only, on the RECEIVER's branch, stamped day-copy with ONE batch id, copying end / volume / priority / name, with the default timezone (none was set), created by the accepter; Late (after the receiver's 22:00 closing) is skipped and listed with the others",
      acc.ok && acc.status === "ACCEPTED" && copies1.length === 3 && new Set(copies1.map((r) => (r.taxonomyTags as Rec[])[0].value)).size === 1 && copies1.every((r) => r.branchId === t1.id && r.workspaceId === ws.id && r.recurrence === "weekly" && J(r.daysOfWeek) === J([1]) && r.timezone === "UTC" && r.createdBy === owner.id && r.enabled) &&
      row("Morning").volume === 40 && row("Morning").priority === 2 && row("Morning").endTimeLocal === "12:00:00" && row("Morning").targetId === pWeb.id && row("Bank").targetType === "BANK" && row("Bank").volume === 25 && row("Quiet").targetType === "SILENCE" &&
      !t1rows.some((r) => r.name === "Late") && acc.result.skipped.length === 6 && acc.result.skipped.some((s: Rec) => s.reason === "after-closing" && s.name === "Late") && acc.result.skipped.some((s: Rec) => s.reason === "local-files"), { acc, names: t1rows.map((r) => r.name) });
    assert("D9 REPLACE THE DAY: the receiver's own blocks of Monday lose Monday (T1 own keeps Tuesday; T1 solo has nothing left so it is DISABLED, not deleted); its Closing and Saturday block are untouched; the offer records how it was applied",
      J(row("T1 own").daysOfWeek) === J([2]) && row("T1 own").enabled && !row("T1 solo").enabled && J(row("T1 solo").daysOfWeek) === J([1]) && row("Closing").enabled && J(row("Closing").daysOfWeek) === J([1]) && row("T1 sat").enabled &&
      acc.result.replaced.length === 2 && offerRow?.appliedMode === "weekday" && J(offerRow?.appliedWeekdays) === J([1]) && !!offerRow?.decidedAt);
    assert("D10 the playlist the day plays is shared to the receiving branch, already ACCEPTED (one share, recorded in the ledger); the audit trail has the send and the answer",
      share1.length === 1 && share1[0]!.status === "ACCEPTED" && share1[0]!.fromUserId === owner.id && acc.result.sharesCreated === 1 &&
      (await prisma.auditLog.count({ where: { workspaceId: ws.id, entityId: O1.id, action: { in: ["schedule_day_share.send", "schedule_day_share.answer"] } } })) === 2);
    const twice = await answer(O1.id, "accept");
    assert("D11 ACCEPT TWICE applies ONCE: the second answer is refused (409) and no row was added", twice.status === 409 && stamped(await schedulesOf(t1.id)).length === 3);

    // ── two requests at the same moment on O2
    const race = await Promise.all([answer(O2.id, "accept"), answer(O2.id, "accept")]);
    const t2rows = await schedulesOf(t2.id);
    assert("D12 TWO ACCEPTS AT THE SAME MOMENT: exactly one applies (the other gets 409), the day is placed once — 4 rows on the receiver (no closing there, so Late fits), the receiver's own blocks replaced once",
      race.filter((r) => r.ok).length === 1 && race.filter((r) => r.status === 409).length === 1 && stamped(t2rows).length === 4 && J(t2rows.find((r) => r.name === "T2 own")!.daysOfWeek) === J([2]) && !t2rows.find((r) => r.name === "Other")!.enabled, race);
    assert("D13 the day is read from the SOURCE branch only: the receiver's own Monday block is not in the offer (it was 'replaced', not copied)", !O2.blocks.some((b: Rec) => b.name === "Other" || b.name === "T2 own"));

    // ── undo O1: edit the Bank copy first
    const bankRow = t1rows.find((r) => r.name === "Bank")!;
    await prisma.schedule.update({ where: { id: bankRow.id }, data: { name: "Bank (edited by the branch)" } });
    const nonSender = await answer(O1.id, "undo", { canUseTarget: false });
    const undo1 = await answer(O1.id, "undo");
    const after1 = await schedulesOf(t1.id);
    const share1b = await prisma.playlistShare.findMany({ where: { playlistId: pWeb.id, targetBranchId: t1.id } });
    assert("D14 UNDO: someone who may not use the branch is refused (403); the copies that were NOT edited are removed (Morning, Quiet); the one the branch edited STAYS and is listed; everything that was replaced is put back (T1 own on Monday + Tuesday, T1 solo enabled); the offer is UNDONE",
      nonSender.status === 403 && undo1.ok && undo1.status === "UNDONE" && undo1.undo.removed === 2 && undo1.undo.leftInPlace.length === 1 && undo1.undo.leftInPlace[0].id === bankRow.id && undo1.undo.restored === 2 &&
      stamped(after1).length === 1 && after1.some((r) => r.id === bankRow.id) && J(after1.find((r) => r.id === own1.id)!.daysOfWeek) === J([1, 2]) && after1.find((r) => r.id === solo1.id)!.enabled && after1.find((r) => r.id === close1.id)!.enabled && after1.find((r) => r.id === sat1.id)!.enabled, undo1);
    assert("D15 UNDO revokes only the shares THIS batch made (the edited block plays a bank, not the playlist, so the share goes); undoing twice is refused (409)", undo1.undo.sharesRevoked === 1 && share1b.every((s) => s.status === "REVOKED") && (await answer(O1.id, "undo")).status === 409);

    // ── undo O2: a playlist block was edited (the share must stay), and the 14-day window
    const morning2 = t2rows.find((r) => r.name === "Morning" && stamped([r]).length === 1)!;
    await prisma.schedule.update({ where: { id: morning2.id }, data: { volume: 55 } });
    const decidedAt = (await prisma.scheduleDayShare.findUnique({ where: { id: O2.id } }))!.decidedAt!;
    const late = await answer(O2.id, "undo", { now: new Date(decidedAt.getTime() + 15 * 86400000) });
    const undo2 = await answer(O2.id, "undo");
    const share2 = await prisma.playlistShare.findMany({ where: { playlistId: pWeb.id, targetBranchId: t2.id } });
    assert("D16 the undo window is 14 days (day 15 is refused, 409); a block the branch edited that plays a playlist keeps that playlist's share (shared, not revoked); the other 3 copies are removed",
      late.status === 409 && undo2.ok && undo2.undo.removed === 3 && undo2.undo.leftInPlace.length === 1 && undo2.undo.sharesKept === 1 && undo2.undo.sharesRevoked === 0 && share2.length === 1 && share2[0]!.status === "ACCEPTED" && J((await prisma.schedule.findUnique({ where: { id: own2.id } }))!.daysOfWeek) === J([1, 2]) && (await prisma.schedule.findUnique({ where: { id: other2.id } }))!.enabled, { late, undo2 });

    // ── decline and revoke
    const o3 = (await send({ requested: [t1.id] })).created[0];
    const dec3 = await answer(o3.id, "decline");
    const acc3 = await answer(o3.id, "accept");
    const o4 = (await send({ requested: [t2.id] })).created[0];
    const revByOther = await answer(o4.id, "revoke", { userId: staff.id });
    const revBySender = await answer(o4.id, "revoke", { canUseTarget: false });
    const accRevoked = await answer(o4.id, "accept");
    assert("D17 DECLINE: the branch says no — nothing is placed, a later accept is refused (409); REVOKE: only the SENDER can take a pending offer back (another person → 403), and an accept after that is refused (409)",
      dec3.ok && dec3.status === "DECLINED" && acc3.status === 409 && stamped(await schedulesOf(t1.id)).length === 1 && revByOther.status === 403 && revBySender.ok && revBySender.status === "REVOKED" && accRevoked.status === 409 && stamped(await schedulesOf(t2.id)).length === 1);

    // ── a date, and 'alongside'
    const dayAfter = ymdOf(new Date(Date.now() + 86400000));
    const o5 = (await send({ requested: [t3.id] })).created[0];
    const pastTry = await answer(o5.id, "preview", { apply: { mode: "date", date: "2020-01-01" } });
    const acc5 = await answer(o5.id, "accept", { apply: { mode: "date", date: dayAfter, conflict: "replace" } });
    const t3rows = await schedulesOf(t3.id);
    const tags3 = (t3rows.find((r) => r.id === own3.id)!.taxonomyTags ?? []) as Rec[];
    assert("D18 A DATE: a past date is refused (400); the copies are one-off blocks on that date; the receiver's active blocks of that day get a skip-date for it (nothing deleted, its Closing untouched)",
      pastTry.status === 400 && acc5.ok && stamped(t3rows).length === 3 && stamped(t3rows).every((r) => r.recurrence === "one_off" && r.oneOffDateLocal === dayAfter && r.daysOfWeek.length === 0) && tags3.some((x) => x.key === "skip-date" && x.value === dayAfter) &&
      !((t3rows.find((r) => r.name === "Closing")!.taxonomyTags ?? []) as Rec[]).some((x) => x.key === "skip-date"), { pastTry, acc5, tags3 });
    const undo5 = await answer(o5.id, "undo");
    assert("D19 undoing a date puts the receiver's block back exactly as it was (its tags are empty again) and removes the 3 one-off copies", undo5.ok && undo5.undo.removed === 3 && (await prisma.schedule.findUnique({ where: { id: own3.id } }))!.taxonomyTags === null);
    const o6 = (await send({ requested: [t3.id] })).created[0];
    const acc6 = await answer(o6.id, "accept", { apply: { mode: "date", date: ymdOf(new Date()), conflict: "alongside" } });
    assert("D20 APPLYING TO TODAY is allowed with a warning; 'alongside' changes none of the receiver's own blocks and flags the block that starts in the same minute (08:00)",
      acc6.ok && acc6.result.warnings.some((w: Rec) => w.code === "today") && acc6.result.ties.some((c: Rec) => c.id === own3.id) && acc6.result.replaced.length === 0 && (await prisma.schedule.findUnique({ where: { id: own3.id } }))!.taxonomyTags === null, acc6);

    // ── caps counted in the database
    await prisma.scheduleDayShare.createMany({ data: Array.from({ length: DAY_SHARE_LIMITS.MAX_PENDING_PER_TARGET }, (_, k) => ({ workspaceId: ws.id, fromBranchId: src.id, targetBranchId: t4.id, fromUserId: owner.id, sourceWeekday: 1, requestId: `cap-${tag}-${k}`, snapshot: { v: 1, weekday: 1, blocks: [], skipped: [] }, expiresAt: new Date(Date.now() + 86400000) })) });
    const capped = await send({ requested: [t4.id, t1.id] });
    const onlyCapped = await send({ requested: [t4.id] });
    assert("D21 CAP: a branch with 20 offers waiting is skipped 'too-many-waiting' (the other still gets its offer); sending to nobody else is refused (400)", capped.ok && capped.created.length === 1 && capped.skippedTargets.some((s: Rec) => s.branchId === t4.id && s.reason === "too-many-waiting") && onlyCapped.status === 400, { capped, onlyCapped });

    // ── reading
    const listed = await store.listOffers({ workspaceId: ws.id, branchIds: "*", statuses: ["PENDING", "ACCEPTED", "DECLINED", "REVOKED", "UNDONE"] });
    const mineSent = await store.listOffers({ workspaceId: ws.id, branchIds: "*", statuses: ["PENDING"], sentBy: staff.id });
    assert("D22 LISTING: inside the business only (another business sees none), by receiving branch, the sender's own offers; a view is whitelisted — no ledger, no local path, no ids of schedules", listed.length >= 8 && (await store.listOffers({ workspaceId: wsB.id, branchIds: "*", statuses: ["PENDING", "ACCEPTED"] })).length === 0 && (await store.listOffers({ workspaceId: ws.id, branchIds: [t1.id], statuses: ["DECLINED"] })).length === 1 && mineSent.length === 0 && !/SECRET-DISK|"ledger"|batchId/.test(J(listed.filter((v) => v.status !== "ACCEPTED" && v.status !== "UNDONE"))));
    const actions = await prisma.auditLog.findMany({ where: { workspaceId: ws.id, entity: "schedule_day_share" }, select: { action: true } });
    const has = (a: string) => actions.some((x) => x.action === a);
    assert("D23 AUDIT: send, answer (accept / decline), revoke and undo each left a row", has("schedule_day_share.send") && has("schedule_day_share.answer") && has("schedule_day_share.revoke") && has("schedule_day_share.undo"), actions);
    // the sending side is fenced too
    const foreignSend = await send({ fromBranchId: bx.id });
    assert("D24 sending FROM a branch of another business is refused (404); a weekday out of range is refused (400); the source branch's own offers are not made to itself", foreignSend.status === 404 && (await send({ weekday: 9 })).status === 400 && (await send({ requested: [src.id] })).status === 400);
  } finally {
    await prisma.auditLog.deleteMany({ where: { workspaceId: { in: [ws.id, wsB.id] } } });
    await prisma.workspace.deleteMany({ where: { id: { in: [ws.id, wsB.id] } } }).catch((e) => console.error("cleanup workspace failed", e instanceof Error ? e.message : e));
    await prisma.user.deleteMany({ where: { email: { endsWith: `-${tag}@example.test` } } }).catch((e) => console.error("cleanup users failed", e instanceof Error ? e.message : e));
    await prisma.$disconnect();
  }
}

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
    console.log("\nSKIPPED the database part (DATABASE_URL is not a localhost database — this part creates and deletes rows; run it with the local .env.development).");
  } else {
    await db();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
