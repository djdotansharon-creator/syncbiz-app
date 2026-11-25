/**
 * CONTROL ROOM — the Schedule section + "send a day to my other branches": the SCREENS (owner 2026-11-25, phase 2, reworked after the owner's feedback: the receiving branch gets a NOTIFICATION and its own OFFER SCREEN).
 * A static guard + the pure helpers.
 *   components/control-room/branch-schedule.tsx (section) · branch-schedule-offer.tsx (notification + offer screen) · branch-schedule-dialogs.tsx (send window) · branch-schedule-parts.tsx · branch-schedule-data.tsx
 *   branch-schedule.css · lib/branch-schedule-lane.ts · lib/schedule-day-share-client.ts (+ the wiring in all-branches-view.tsx and the Hebrew in lib/i18n/phrases.ts)
 * The runtime check (a real browser, three looks, Hebrew) is kept next to the screenshots: the Playwright script `runtime.mjs` of the same work.
 * Run: npx tsx scripts/verify-schedule-day-ui.ts
 */
import { readFileSync } from "node:fs";
import { HE_PHRASES } from "../lib/i18n/phrases";
import { SKIP_REASON_TEXT, type SkippedBlock, type SnapshotBlock } from "../lib/schedule-day-share-rules";
import {
  SEND_CAP_TEXT,
  KNOWN_ERRORS,
  WEEKDAYS_FULL,
  WEEKDAYS_SHORT,
  cannotBePlaced,
  errorText,
  isSafeCover,
  laneBlocks,
  laneBox,
  laneRange,
  laneTimes,
  newRequestId,
  nextDateOfWeekday,
  ownBlocksOn,
  snapshotLane,
  todayYmd,
  undoableOffers,
  weekdayOfDate,
} from "../lib/branch-schedule-lane";
import type { Schedule } from "../lib/types";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => { if (c) { pass++; console.log("  ✓", m); } else { fail++; console.log("  ✗ FAIL:", m); } };
const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

const SECTION = read("components/control-room/branch-schedule.tsx");
const OFFER = read("components/control-room/branch-schedule-offer.tsx");
const DIALOGS = read("components/control-room/branch-schedule-dialogs.tsx");
const PARTS = read("components/control-room/branch-schedule-parts.tsx");
const DATA = read("components/control-room/branch-schedule-data.tsx");
const CSS = read("components/control-room/branch-schedule.css");
const LANE = read("lib/branch-schedule-lane.ts");
const CLIENT = read("lib/schedule-day-share-client.ts");
const VIEW = read("components/control-room/all-branches-view.tsx");
const ROUTE_LIST = read("app/api/schedule-day-shares/route.ts");
const ROUTE_ONE = read("app/api/schedule-day-shares/[id]/route.ts");
const ROUTE_PREVIEW = read("app/api/schedule-day-shares/preview/route.ts");
const ALL_UI = [SECTION, OFFER, DIALOGS, PARTS, DATA].join("\n");
/** the source of one function / component: from its start to the next top-level declaration */
const bodyOf = (src: string, start: string): string => {
  const i = src.indexOf(start);
  if (i < 0) return "";
  const rest = src.slice(i + start.length);
  const m = /\n(?:export )?(?:function|const|type|async function) |\n\/\/ ──/.exec(rest);
  return src.slice(i, i + start.length + (m ? m.index : rest.length));
};

// ── DU1 — every word the screens show exists in Hebrew too ───────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("DU1 — every string is in both languages");
const keys = new Set<string>();
for (const m of ALL_UI.matchAll(/\btr\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(m[1]!.replace(/\\"/g, '"'));
for (const m of ALL_UI.matchAll(/\btitle="([^"{}]+)"/g)) keys.add(m[1]!); // GlassModal titles are English keys it translates itself
for (const v of Object.values(SKIP_REASON_TEXT)) keys.add(v);
for (const v of KNOWN_ERRORS) keys.add(v);
for (const m of DIALOGS.matchAll(/^\s*"[a-z-]+": "([^"]+)",?$/gm)) keys.add(m[1]!); // TARGET_REASON
for (const v of ["The time for undoing this is over", "This day is too big to send", "You don't have permission to do this.", "This is no longer there.", "This offer is no longer open.", "Something went wrong. Try again.", "No connection. Try again.", "Your session ended. Sign in again."]) keys.add(v);
for (const d of [...WEEKDAYS_FULL, ...WEEKDAYS_SHORT]) keys.add(d);
keys.add(SEND_CAP_TEXT);
const missing = [...keys].filter((k) => !HE_PHRASES[k] || !HE_PHRASES[k]!.trim());
ok(keys.size > 120, `${keys.size} strings found in the screens`);
ok(missing.length === 0, `none is missing in Hebrew${missing.length ? ": " + missing.slice(0, 5).join(" | ") : ""}`);
const holes = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(",");
const badVars = [...keys].filter((k) => HE_PHRASES[k] && holes(k) !== holes(HE_PHRASES[k]!));
ok(badVars.length === 0, `every {placeholder} survives in Hebrew${badVars.length ? ": " + badVars.slice(0, 3).join(" | ") : ""}`);
ok(WEEKDAYS_FULL.every((d) => /^[\u0590-\u05FF]+$/.test(HE_PHRASES[d] ?? "")), "the seven days are in Hebrew");
ok(!/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(ALL_UI + CSS + LANE + CLIENT), "no emoji (and no music-note character) in the new files");

// ── DU2 — the send button is for the owner only; nothing can be edited on these screens ─────────────────────────────────────────────────────────────────────────────
console.log("DU2 — owner only · read only");
ok(/isOwner \? \(\s*<button[\s\S]{0,400}onClick=\{\(\) => setSending\(true\)\}/.test(SECTION), "the send button is drawn only when isOwner, and it is the only thing that opens the send window");
ok((SECTION.match(/setSending\(true\)/g) ?? []).length === 1, "…nothing else opens the send window");
ok(/\{sending \? <SendDayDialog/.test(SECTION), "the send window is rendered only while 'sending'");
ok(!/SendDayDialog|isOwner/.test(OFFER), "the receiving side has no send button at all");
ok(/isOwner=\{isHQ\}/.test(VIEW) && /setIsHQ\(d\?\.accessType === "OWNER"\)/.test(VIEW) && /const \[isHQ, setIsHQ\] = useState\(false\)/.test(VIEW), "the Control Room gives the section isOwner = the account's OWNER access (false until it is read)");
const laneFn = PARTS.slice(PARTS.indexOf("export function DayLane"), PARTS.indexOf("export function WhyList"));
ok(laneFn.length > 500 && !/\bon[A-Z][A-Za-z]+=/.test(laneFn) && !/draggable|contentEditable|tabIndex|\bonClick\b/.test(laneFn), "the small lane has no event handlers, no drag, no edit");
ok(/role="list"/.test(laneFn) && /role="listitem"/.test(laneFn) && /aria-label=\{`\$\{name\}, \$\{laneTimes\(b\)\}`\}/.test(laneFn), "…it is a labelled list (each block: name, times)");
const dayFn = bodyOf(OFFER, "function StudioDay(");
ok(dayFn.length > 500 && !/\bon[A-Z][A-Za-z]+=/.test(dayFn) && !/draggable|contentEditable|tabIndex|\bonClick\b/.test(dayFn) && /role="list"/.test(dayFn) && /aria-label=\{`\$\{name\}, \$\{laneTimes\(b\)\}`\}/.test(dayFn), "the Studio-style day on the offer screen is read only too (no handlers; a labelled list)");
ok(!/method:\s*"(PUT|PATCH|DELETE)"/.test(ALL_UI + CLIENT), "the screens never write with PUT / PATCH / DELETE");
ok(!/method:/.test(SECTION + PARTS + OFFER + DATA) && (DATA.match(/fetch\(`\/api\/schedules\?branchId=/g) ?? []).length === 1, "the branch's own schedule is only READ (one GET, no method)");
ok(!/prisma|schedule-day-share-store"/.test(ALL_UI.replace(/import type[^;]+;/g, "")) && !/@\/lib\/prisma/.test(ALL_UI + CLIENT + LANE), "no database code in the browser files (types only)");

// ── DU3 — the calls match the server ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("DU3 — the API paths, actions and bodies are the server's");
const serverActions = /const ACTIONS: DayShareAction\[\] = \[([^\]]+)\]/.exec(ROUTE_ONE)![1]!.match(/"([a-z]+)"/g)!.map((s) => s.replace(/"/g, ""));
const sentActions = [...CLIENT.matchAll(/action: "([a-z]+)"/g)].map((m) => m[1]!);
ok(sentActions.length === 4 && sentActions.every((a) => serverActions.includes(a)), `the screens send only actions the server knows (${[...new Set(sentActions)].join(", ")})`);
ok(["preview", "accept", "decline", "undo"].every((a) => sentActions.includes(a)), "…preview, accept, decline and undo are all used");
ok(!sentActions.includes("revoke"), "…and 'revoke' (the sender's) is not offered by these screens");
ok(/"\/api\/schedule-day-shares\/preview"/.test(CLIENT) && /"\/api\/schedule-day-shares"/.test(CLIENT) && /`\/api\/schedule-day-shares\/\$\{encodeURIComponent\(offerId\)\}`/.test(CLIENT), "paths: list+send, preview, one offer");
ok(/\/api\/schedule-day-shares\?\$\{q\.toString\(\)\}/.test(CLIENT) && /q\.set\("branchId"/.test(CLIENT), "the list asks ?status= and &branchId=");
ok(/s === "accepted"/.test(ROUTE_LIST) && /s === "all"/.test(ROUTE_LIST) && /s === "history"/.test(ROUTE_LIST) && /"pending"/.test(ROUTE_LIST) && /type OfferStatusQuery = "pending" \| "accepted" \| "history" \| "all"/.test(CLIENT), "the status words are the server's (pending / accepted / all / history)");
for (const k of ["fromBranchId", "weekday", "targetBranchIds", "requestId"]) ok(new RegExp(`\\b${k}\\b`).test(ROUTE_LIST) && new RegExp(`\\b${k}\\b`).test(CLIENT), `body field ${k} is read by the server and sent by the client`);
for (const k of ["fromBranchId", "weekday", "targetBranchIds"]) ok(new RegExp(`\\b${k}\\b`).test(ROUTE_PREVIEW), `the dry run reads ${k}`);
ok(/mode must be "weekday" or "date"/.test(ROUTE_ONE) && /mode: "weekday", weekdays: c\.weekdays/.test(CLIENT) && /mode: "date", date: c\.date/.test(CLIENT), "apply body: mode weekday + weekdays, or mode date + date");
ok(/conflict must be "replace" or "alongside"/.test(ROUTE_ONE) && /conflict: "replace" \| "alongside"/.test(CLIENT) && /useState<"replace" \| "alongside">\("replace"\)/.test(OFFER), "conflict is replace | alongside, and 'Replace that day' is the default");
ok(/min=\{today\}/.test(OFFER) && /todayYmd\(now\)/.test(OFFER), "the date picker starts today (the server refuses a past date)");
// the idempotent requestId: a fresh one per click — made inside the click handler, never kept
const sendFn = DIALOGS.slice(DIALOGS.indexOf("const send = async"), DIALOGS.indexOf("const nameOf"));
ok(/requestId: newRequestId\(\)/.test(sendFn) && (DIALOGS.match(/newRequestId\(\)/g) ?? []).length === 1, "requestId = newRequestId() is made inside the send click (one per click)");
const idRegex = new RegExp(/const REQUEST_ID = (\/.+\/);/.exec(ROUTE_LIST)![1]!.slice(1, -1));
const ids = Array.from({ length: 200 }, () => newRequestId());
ok(ids.every((id) => idRegex.test(id)) && new Set(ids).size === 200, "200 requestIds: all accepted by the server's pattern, all different");
ok(/canSend/.test(sendFn) && /disabled=\{!canSend\}/.test(DIALOGS), "a second click while sending does nothing (the button is off while busy)");
ok(/DAY_SHARE_LIMITS\.MAX_TARGET_BRANCHES/.test(DIALOGS) && /others\.slice\(0, MAX_TARGETS\)/.test(DIALOGS) && /selectable\.slice\(0, MAX_TARGETS\)/.test(DIALOGS) && /p\.length >= MAX_TARGETS \? p/.test(DIALOGS), "the dry run, 'All branches' and the ticks stay inside the server's cap of branches per send");
ok(!/targetBranchIds: "all"/.test(DIALOGS), "the window never asks the server for 'all' (a business with more than 50 branches would be refused)");
ok(errorText(413, "A day can be sent to at most 50 branches at once") === SEND_CAP_TEXT && SEND_CAP_TEXT.includes("50"), "the server's 'at most 50 branches' is said in plain words");

// ── DU4 — the receiving side: a NOTIFICATION, and its own screen ────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("DU4 — notification + offer screen");
ok(!/OfferCard|cr-sch-wait|UseDayDialog|branchId, status: "pending"/.test(SECTION + DIALOGS), "the branch screen's section has no 'Schedule waiting' card, no mini lane for offers, no pending read — only the Undo rows (accepted)");
ok(/listOffers\(\{ branchId, status: "accepted" \}\)/.test(SECTION) && /undoableOffers\(offers\.accepted, new Date\(\)\)/.test(SECTION) && /undoOffer\(o\.id\)/.test(SECTION), "Undo rows come from the accepted offers still inside their undo time");
const pillFn = bodyOf(OFFER, "export function SchedulePill(");
ok(pillFn.includes('status: "pending"') && /<button type="button" className="cr-sch-pill" onClick=\{onOpen\}/.test(pillFn) && !/DayLane|StudioDay|<ul|<table/.test(pillFn), "the notification is ONE button (no strip, no list, no lane) that opens the offer screen");
ok(/if \(list\.length === 0\) return null/.test(pillFn) && /list\.length > 1 \? <span className="cr-sch-count">/.test(pillFn) && /A schedule is waiting · from \{branch\}/.test(pillFn) && /Schedules are waiting/.test(pillFn), "…nothing when nothing waits; 'A schedule is waiting · from <branch>'; a count when several");
ok(/aria-label=\{text\}/.test(pillFn), "…and it has an accessible name");
const screen = bodyOf(OFFER, "export function BranchOfferScreen(");
ok(screen.length > 800 && !/GlassModal|DayLane|BranchDevices|BranchJingles|BranchPeople|StationActivation|BranchSchedule\b|SendDayDialog/.test(OFFER.replace(/BranchSchedule\.|branch-schedule/g, "")), "the offer screen is not a window and brings none of the branch screen's other parts");
ok(/<header className="cr-bp-head">[\s\S]{0,700}cr-bp-back[\s\S]{0,700}<LogoTile[\s\S]{0,300}<h2 dir="auto">\{name\}<\/h2>/.test(screen) && !/StatusLed|cr-bp-status|BranchMenu/.test(screen), "its header is the back arrow + the branch's logo and name — nothing else");
ok(/<h3 className="cr-sch-os-title"[^>]*>\{tr\("Schedule"\)\}<\/h3>/.test(screen), "under it the title 'Schedule'");
ok(/e\.key === "Escape"\) onBack\(\)/.test(screen) && /aria-label=\{tr\("Back"\)\}/.test(screen) && /titleRef\.current\?\.focus\(\)/.test(screen), "Esc and the back arrow return; focus lands on the title");
ok(/onBack=\{\(\) => setOfferFor\(null\)\}/.test(VIEW) && /if \(open && offerFor === open\.id\) \{/.test(VIEW) && VIEW.indexOf("offerFor === open.id") < VIEW.indexOf("<BranchPanel"), "the Control Room swaps the branch screen for the offer screen (and back)");
ok(/<BranchOfferScreen[\s\S]{0,700}name=\{open\.name\}[\s\S]{0,500}logoUrl=\{/.test(VIEW) && /<SchedulePill key=\{`pill-\$\{open\.id\}`\} branchId=\{open\.id\} onOpen=\{\(\) => setOfferFor\(open\.id\)\} \/>\s*<BranchPanel/.test(VIEW) && /headerEnd=\{<BranchPeople key=/.test(VIEW), "the notification sits right above the branch title and opens it (the people strip keeps its place in the header)");
// the day, the Studio's way
ok(/\/api\/playlists/.test(DATA) && /m\.set\(p\.id, \{ name: p\.name, cover: isSafeCover\(c\) \? c : null \}\)/.test(DATA) && /b\.targetType === "PLAYLIST" \? playlists\?\.get\(b\.targetId\)\?\.cover/.test(OFFER), "covers come from the playlists the workspace already lists, by target id");
ok(/<img className="cr-sch-art"[^>]*onError=/.test(OFFER) && /cr-sch-art is-ph/.test(OFFER) && /cr-sch-art is-quiet/.test(OFFER), "a block shows its cover, else the placeholder, else (quiet) the hatch; a broken picture falls back to the placeholder");
ok(/<StudioDay blocks=\{lane\} playlists=\{playlists\}/.test(OFFER) && /<Agenda blocks=\{lane\} playlists=\{playlists\}/.test(OFFER) && /The day, hour by hour/.test(OFFER), "the day lane with covers AND 'The day, hour by hour' with a cover on every row (as the Studio's day view)");
ok(/\.cr-sch-sd-b[^{]*\{[^}]*overflow: hidden/.test(CSS) && /\.cr-sch-sd-text \{[^}]*linear-gradient\(to bottom, transparent 0, color-mix\(in srgb, var\(--cs-fog\)/.test(CSS) && /\.cr-sch-art\.is-ph \{[^}]*repeating-linear-gradient\(135deg/.test(CSS) && /\.cr-sch-art\.is-quiet \{[^}]*repeating-linear-gradient\(135deg/.test(CSS) && /--cs-fog: #0b0b0d/.test(CSS) && /--cs-ph-a: #121215/.test(CSS), "the Studio's visual language is recreated (cover behind a fog veil, hatched placeholder, hatched quiet blocks, the Studio's fog colours)");
ok(!/schedules-studio|from "@\/components\/schedules-studio/.test(ALL_UI + CSS), "…without importing or editing the Studio (only pure helpers from lib/schedules-timeline.ts)");
ok(/from "@\/lib\/schedules-timeline"/.test(OFFER) && /(formatMinutes|tickStep|windowTicks)/.test(OFFER), "the pure helpers are reused");
// what the screen offers
ok(/cannotBePlaced\(data\.skipped\)/.test(OFFER) && /<WhyList skipped=\{cannot\} \/>/.test(OFFER) && /ownBlocksOn\(ownItems\.filter\(\(s\) => s\.branchId === branchId\), choice\)/.test(OFFER) && /setSeenKey\(dayKeyOf\(choice\)\)/.test(OFFER) && /tr\("Replace that day"\)/.test(OFFER) && /tr\("Keep both"\)/.test(OFFER) && /tr\("What will happen"\)/.test(OFFER), "under the day: what can't be placed (with reasons), the conflict note, Replace / Keep both, What will happen");
ok(/previewAccept\(offer\.id, choice\)/.test(OFFER) && /acceptOffer\(offer\.id, choice\)/.test(OFFER) && OFFER.indexOf("previewAccept(") < OFFER.indexOf("acceptOffer("), "'what will happen' (preview) comes before accept");
ok(/disabled=\{!canUse\}/.test(OFFER) && /data\.willPlace\.length > 0/.test(OFFER) && /declineOffer\(offer\.id\)/.test(OFFER) && /tr\("Not now"\)/.test(OFFER) && /tr\("Use this"\)/.test(OFFER), "[Use this] waits for the preview; [Not now] declines");
const useFn = bodyOf(OFFER, "  const use = async () => {");
const noFn = bodyOf(OFFER, "  const notNow = async () => {");
ok(/postScheduleNotice\(branchId/.test(useFn) && /onBack\(\)/.test(useFn) && /postScheduleNotice\(branchId/.test(noFn) && /onBack\(\)/.test(noFn), "both answers leave one calm line and return to the branch screen");
ok(/peekScheduleNotice\(branchId\)/.test(SECTION) && /clearScheduleNotice\(branchId\)/.test(SECTION) && /role="status"/.test(SECTION) && /cr-sch-notice/.test(SECTION), "…the branch screen shows that line once");
ok(/role="status"/.test(DATA) && /role="alert"/.test(OFFER) && /aria-live="polite"/.test(OFFER), "states are announced (status / alert / live)");
ok(/cr-sch-spin/.test(DATA) && /tr\("Can't load the schedule\."\)/.test(SECTION) && /tr\("Nothing planned on this day\."\)/.test(SECTION) && /tr\("No schedule is waiting\."\)/.test(OFFER), "loading, error and empty states exist");
ok(/aria-pressed=\{i === day\}/.test(SECTION) && /aria-pressed=\{weekdays\.includes\(i\)\}/.test(OFFER), "the day chips are real buttons with aria-pressed");
ok(/list\.length > 1 \? \(\s*<div className="cr-sch-os-pick"/.test(OFFER) && /aria-pressed=\{o\.id === offer\.id\}/.test(OFFER), "several waiting offers: a plain choice between them on the offer screen");
ok(/<GlassModal/.test(DIALOGS) && (DIALOGS.match(/<GlassModal/g) ?? []).length === 1 && /"Escape"/.test(read("components/glass-modal.tsx")), "the owner's send window is the Control Room's glass window (Esc closes) — the only window left");

// ── DU5 — the wiring on the branch screen and in the list ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("DU5 — wiring");
const iDev = VIEW.indexOf("<BranchDevices"), iSch = VIEW.indexOf("<BranchSchedule "), iJin = VIEW.indexOf("<BranchJingles");
ok(iDev > 0 && iSch > iDev && iJin > iSch, "the section sits between the devices and the jingles");
ok(/waiting=\{waitingOffers\.counts\[r\.id\] \?\? 0\}/.test(VIEW) && /cr-sch-rowdot/.test(VIEW) && /useWaitingDayOffers\(\)/.test(VIEW), "a branch row keeps its small dot while a schedule waits for it");
ok((VIEW.match(/onChanged=\{waitingOffers\.refresh\}/g) ?? []).length === 2, "answering or undoing refreshes the dots");
ok(/key=\{`sch-\$\{open\.id\}`\}/.test(VIEW), "the section is re-made for each branch (no stale state)");
ok(!/desktop\/|server\/index|master/i.test(ALL_UI + CLIENT), "no player / desktop / MASTER code touched or referenced");

// ── DU6 — the styles stay inside, and carry no frames ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("DU6 — the css is scoped, frameless");
const bare = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const selectors = [...bare.matchAll(/(^|\})\s*([^{}@][^{}]*)\{/g)].map((m) => m[2]!.trim()).filter((x) => x && !x.startsWith("@")); // at-rule preludes are not selectors
const outside = selectors.flatMap((s) => s.split(",").map((x) => x.trim())).filter((x) => !/cr-sch/.test(x) && !/^(from|to|\d+%)$/.test(x));
ok(selectors.length > 90 && outside.length === 0, `every one of ${selectors.length} rules is about .cr-sch*${outside.length ? " — outside: " + outside.slice(0, 3).join(" | ") : ""}`);
const noWhiteRule = bare.replace(/html\[data-sb-display="white"\]\[data-sb-control\][^{]*\{[^}]*\}/g, "");
ok(!/rgba?\(\s*255\s*,\s*255\s*,\s*255/.test(bare) && !/#fff\b|#ffffff\b/i.test(noWhiteRule), "no hard-coded white — the colours come from the look's own text colour (the white look sets its own few tokens)");
ok(/--cs-on-ink: #ffffff; --cs-warn: #8a5a00; --cs-bad: #b4232f;/.test(CSS) && /--cs-fog: #ffffff; --cs-fog-ink: #1c1c1e; --cs-ph-a: #f6f7f9; --cs-ph-b: #eceef2;/.test(CSS) && /html\[data-sb-display="white"\]\[data-sb-control\]/.test(CSS), "the white look sets its tokens (on-ink, amber, red, the Studio's fog and stripes)");
const rules = [...bare.matchAll(/([^{}@][^{}]*)\{([^}]*)\}/g)].map((m) => ({ sel: m[1]!.trim(), body: m[2]! }));
const framed = rules.filter((r) => /\bborder:(?!\s*0\b)/.test(r.body) && /border-radius/.test(r.body) && !/cr-sch-spin/.test(r.sel));
ok(framed.length === 0, `no framed boxes (a border together with rounded corners)${framed.length ? ": " + framed[0]!.sel : ""}`);
ok(!rules.some((r) => /cr-sch-(os-body|wait|offer|pill-row)\s*$/.test(r.sel) && /background:/.test(r.body)), "the offer screen and the notification row are plain text on the page (no panel behind them)");
ok(!/margin-left|margin-right|padding-left|padding-right|\bleft:|\bright:|text-align:\s*(left|right)/.test(bare), "logical properties only (Hebrew right-to-left)");
ok(/prefers-reduced-motion: reduce/.test(CSS) && /\.cr-sch-os, \.cr-sch \.cr-sch-notice \{ animation: none; \}/.test(CSS), "the entrance is off for reduced motion");

// ── DU7 — the pure helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
console.log("DU7 — the lane, the dates, the words");
const S = (o: Partial<Schedule> & { id: string; startTimeLocal: string }): Schedule => ({ accountId: "a", branchId: "b", targetType: "PLAYLIST", targetId: "pl-" + o.id, daysOfWeek: [2], endTimeLocal: "23:59:00", enabled: true, priority: 1, recurrence: "weekly", ...o });
const sched: Schedule[] = [
  S({ id: "m", name: "Morning", startTimeLocal: "09:00:00" }),
  S({ id: "l", name: "Lunch", startTimeLocal: "13:00:00", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }),
  S({ id: "x", name: "Paused", startTimeLocal: "15:00:00", enabled: false }),
  S({ id: "o", name: "One time", startTimeLocal: "16:00:00", recurrence: "one_off", oneOffDateLocal: "2026-12-01", daysOfWeek: [] }),
  S({ id: "c", name: "Closing", startTimeLocal: "21:00:00", targetType: "SILENCE", targetId: "silence", daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }),
  S({ id: "q", name: "", startTimeLocal: "18:00:00", targetType: "SILENCE", targetId: "silence" }),
  S({ id: "s", name: "Skipped one date", startTimeLocal: "11:00:00", skipDates: ["2026-12-01"] }),
];
const labels = { quiet: "Quiet", closing: "Closing" };
const lane = laneBlocks(sched, 2, (s) => s.name ?? "", labels);
ok(lane.map((b) => b.key).join(",") === "m,s,l,q,c", `the lane is the weekly routine: ${lane.map((b) => b.key).join(",")} (a paused, a one-time block are not drawn; a date's skip does not remove a weekly block)`);
ok(lane.find((b) => b.key === "m")?.targetType === "PLAYLIST" && lane.find((b) => b.key === "m")?.targetId === "pl-m" && lane.find((b) => b.key === "c")?.targetType === "SILENCE", "a lane block knows what it plays (the offer screen finds the cover by it)");
ok(lane.find((b) => b.key === "c")?.closing === true && lane.find((b) => b.key === "c")?.quiet === true && lane.find((b) => b.key === "c")?.name === "Closing", "the closing block is quiet and named Closing");
ok(lane.find((b) => b.key === "q")?.name === "Quiet" && lane.find((b) => b.key === "q")?.closing === false, "another quiet block is named Quiet");
ok(laneBlocks(sched, 4, (s) => s.name ?? "", labels).map((b) => b.key).join(",") === "l,c", "Thursday: Lunch and Closing (the daily ones)");
ok(lane.every((b, i) => i === 0 || lane[i - 1]!.start <= b.start), "in time order");
const r = laneRange(lane);
ok(r.first === 9 * 60 && r.last === 24 * 60, `the lane covers 09:00 → 24:00 (${r.first}–${r.last})`);
ok(laneRange([]).last - laneRange([]).first === 12 * 60, "an empty day still has a range");
const short = laneRange([{ key: "a", start: 600, end: 630, name: "x", quiet: false, closing: false, tone: 0, targetType: "PLAYLIST", targetId: "p" }]);
ok(short.last - short.first === 240 && short.first <= 600 && short.last >= 630, "a short day is shown at least four hours wide");
const box = laneBox({ start: 12 * 60, end: 18 * 60 }, { first: 8 * 60, last: 20 * 60 });
ok(Math.abs(box.left - 33.333) < 0.01 && Math.abs(box.width - 50) < 0.01, "a block's place in the lane, in percent");
ok(laneTimes({ start: 540, end: 1440 }) === "09:00 – 24:00", "times read 09:00 – 24:00");
const snap: SnapshotBlock[] = [
  { time: "09:00:00", end: "23:59:00", name: "Morning", target: { type: "PLAYLIST", id: "p1", name: "Morning mix" }, volume: null, priority: 1 },
  { time: "13:00:00", end: "14:30:00", name: null, target: { type: "SILENCE", id: "silence", name: "Quiet" }, volume: 40, priority: 1 },
];
const sl = snapshotLane(snap, 2, labels);
ok(sl.length === 2 && sl[0]!.name === "Morning mix" && sl[0]!.targetId === "p1" && sl[1]!.quiet && sl[1]!.end === 14 * 60 + 30, "an offer's blocks are drawn by the same code (playlist name and id, quiet, its own end)");
ok(isSafeCover("https://x.test/a.jpg") && isSafeCover("data:image/png;base64,AAAA") && isSafeCover("/api/artwork/1.jpg") && !isSafeCover("C:\\music\\cover.jpg") && !isSafeCover("file:///Users/a/cover.jpg") && !isSafeCover("//evil.test/x.jpg") && !isSafeCover("") && !isSafeCover(null), "a cover is a web / inline / site address — never a file path of a computer");
const own: Schedule[] = [
  S({ id: "a", startTimeLocal: "08:00:00", daysOfWeek: [2, 3] }),
  S({ id: "b", startTimeLocal: "09:00:00", daysOfWeek: [3], enabled: false }),
  S({ id: "c", startTimeLocal: "10:00:00", recurrence: "one_off", oneOffDateLocal: "2026-12-01", daysOfWeek: [] }),
  S({ id: "d", startTimeLocal: "11:00:00", daysOfWeek: [2], skipDates: ["2026-12-08"] }),
];
ok(ownBlocksOn(own, { mode: "weekday", weekdays: [2] }) === 2 && ownBlocksOn(own, { mode: "weekday", weekdays: [3] }) === 1 && ownBlocksOn(own, { mode: "weekday", weekdays: [5] }) === 0 && ownBlocksOn(own, null) === 0, "the conflict note counts this branch's active weekly blocks on the chosen weekdays");
ok(ownBlocksOn(own, { mode: "date", date: "2026-12-01" }) === 3 && ownBlocksOn(own, { mode: "date", date: "2026-12-08" }) === 1, "…and, for one date, the weekly ones that day (not switched off for it) plus the one-time block of that date");
ok(todayYmd(new Date(2026, 10, 5)) === "2026-11-05", "today as YYYY-MM-DD");
ok(weekdayOfDate("2026-11-25") === 3 && weekdayOfDate("2026-12-01") === 2, "the weekday of a date (25 Nov 2026 = Wednesday)");
ok(nextDateOfWeekday(new Date(2026, 10, 25), 2) === "2026-12-01" && nextDateOfWeekday(new Date(2026, 10, 25), 3) === "2026-11-25" && nextDateOfWeekday(new Date(2026, 11, 30), 1) === "2027-01-04", "the next date on a weekday (today counts; crosses month and year)");
const skipped: SkippedBlock[] = [
  { time: "17:00:00", name: "Local", targetType: "PLAYLIST", targetName: "Local songs", reason: "local-files" },
  { time: "21:00:00", name: "Closing", targetType: "SILENCE", targetName: null, reason: "closing-kept" },
];
ok(cannotBePlaced(skipped).length === 1 && cannotBePlaced(skipped)[0]!.reason === "local-files", "'can't be placed' leaves out the kept closing");
const now = new Date("2026-11-25T12:00:00Z");
const offers = [
  { id: "a", undoableUntil: "2026-12-05T00:00:00Z", decidedAt: "2026-11-21T00:00:00Z" },
  { id: "b", undoableUntil: "2026-11-24T00:00:00Z", decidedAt: "2026-11-10T00:00:00Z" },
  { id: "c", undoableUntil: null, decidedAt: null },
  { id: "d", undoableUntil: "2026-12-09T00:00:00Z", decidedAt: "2026-11-25T00:00:00Z" },
];
ok(undoableOffers(offers, now).map((o) => o.id).join(",") === "d,a", "Undo rows: only those still inside their time, newest first");
ok(errorText(429, "Too many sends in a short time. Try again later.") === "Too many sends in a short time. Try again later." && errorText(403, "Only an owner of the business can send a day of a schedule to other branches").startsWith("Only an owner"), "429 and 403 keep the server's own plain sentence");
ok(errorText(400, "Nothing in this day can be placed on another branch") === "Nothing in this day can be placed on another branch", "400 'nothing can be placed' is kept");
ok(errorText(409, "The 14-day window for undoing this offer is over") === "The time for undoing this is over" && errorText(413, "A day of more than 200 blocks cannot be sent") === "This day is too big to send", "the numbers are not shown to the owner");
ok(errorText(500, "boom {sql}") === "Something went wrong. Try again." && errorText(0, null) === "No connection. Try again." && errorText(403, "weird") === "You don't have permission to do this.", "anything unknown becomes one calm line by status");
ok([200, 400, 401, 403, 404, 409, 410, 413, 429, 500, 0].every((s) => !/\d{3}/.test(errorText(s, "x"))), "no status number is ever shown");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
