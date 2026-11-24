/**
 * SENDING ONE DAY OF A BRANCH'S SCHEDULE TO THE OTHER BRANCHES OF THE SAME BUSINESS — the rules (owner 2026-11-25, phase 1: the server). PURE: no store, no fetch, no clock (callers pass `now`).
 *
 * The product rules (all decided by the owner):
 *   · the receiving branch gets an OFFER and decides (accept / decline); nothing changes in its schedule before it accepts;
 *   · "Replace that day" is the default: the target's own blocks of that day are switched off (a date) or lose that weekday (a weekly routine) — never deleted; "alongside" only flags same-minute ties;
 *   · a block that cannot be placed is SKIPPED and LISTED (never silently dropped): a playlist with a local file (the music is on one computer), a radio station, a single source, a bank the business was not opened to,
 *     anything that is not part of this business, a playlist with nothing playable, a block that starts after the target's own closing;
 *   · the source branch's own "Closing" blocks are not copied — the target keeps its own closing;
 *   · applying to today is allowed (with a warning); a past date is refused; an offer can be undone for 14 days;
 *   · wall-clock times are copied as they are and NO timezone is set: the engine runs on the player's own clock (lib/schedule-window.ts).
 * What is stored in the offer is a WHITELISTED snapshot (time, end, name, target {type, id, name}, volume, priority) — never a local file path or address (CLAUDE.md §12).
 */
import { isYmd, tagsWithSkipDates, ymdOf, skipDatesFromTags } from "./schedule-skip";

export type DayShareStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "REVOKED" | "UNDONE";
export type DayShareAction = "accept" | "decline" | "revoke" | "undo" | "preview";
export type ConflictMode = "replace" | "alongside";
export type ApplyMode = "weekday" | "date";

export const DAY_SHARE_LIMITS = {
  /** sends (one send = one request, however many branches) per person per hour — the soft layer (lib/simple-rate-limit.ts) */
  SENDS_PER_HOUR: 10,
  MAX_TARGET_BRANCHES: 50,
  MAX_BLOCKS: 200,
  /** offers waiting (pending and not expired) for ONE branch, from anyone — counted in the database */
  MAX_PENDING_PER_TARGET: 20,
  /** a PENDING offer cannot be accepted after this many days */
  OFFER_TTL_DAYS: 30,
  /** an accepted offer can be undone for this many days */
  UNDO_DAYS: 14,
} as const;

/** every Schedule row an accept creates carries {key: DAY_COPY_TAG_KEY, value: <batchId>} in its tags (precedent: lib/schedule-skip.ts) — nothing is added to the Schedule table */
export const DAY_COPY_TAG_KEY = "day-copy";
/** the name of the quiet block the Business-hours dialog keeps for each closing time (components/schedules-studio/schedules-studio.tsx CLOSING_NAME) */
export const CLOSING_BLOCK_NAME = "Closing";

const DAY_MS = 24 * 60 * 60 * 1000;

// ── time helpers (pure; the stored text is kept as it is) ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** "HH:mm" / "HH:mm:ss" → minutes since midnight; null when it is not a time */
export function timeToMinutes(raw: unknown): number | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** the time as HH:mm:ss (the form the schedule rows hold); `fallback` when it is not a time */
export function normTime(raw: unknown, fallback: string): string {
  const m = String(raw ?? "").trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return fallback;
  const h = Math.min(23, Number(m[1]));
  const min = Math.min(59, Number(m[2]));
  const sec = m[3] != null ? Math.min(59, Number(m[3])) : 0;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(min)}:${p(sec)}`;
}

/** the weekday (0 = Sunday … 6 = Saturday) of a calendar date written YYYY-MM-DD — built from its parts, so no time zone is involved */
export function weekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).getDay();
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return ymdOf(new Date(y, m - 1, d + days));
}

const cleanName = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().slice(0, 200) : "";
  return s ? s : null;
};
const cleanVolume = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100 ? v : null);
const cleanPriority = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(99, Math.trunc(v))) : 1);
const isWeekday = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 6;

// ── 1. the snapshot of a day ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DayBlockIn = {
  id: string;
  name?: string | null;
  targetType: string;
  targetId: string;
  startTimeLocal: string;
  endTimeLocal?: string | null;
  volume?: number | null;
  priority?: number | null;
  enabled: boolean;
  recurrence?: string | null;
  daysOfWeek: number[];
};

/** what the server knows about the things the blocks play — resolved by the store, never by the client */
export type PlaylistFact = { name: string; workspaceId: string | null; branchId: string | null; hasLocalFiles: boolean; hasHttpPlayable: boolean };
export type BankFact = { name: string; open: boolean };
export type TargetFacts = {
  /** the business the offer is made in */
  workspaceId: string;
  playlists: Record<string, PlaylistFact | undefined>;
  banks: Record<string, BankFact | undefined>;
};

export type SnapshotTarget = { type: "PLAYLIST" | "BANK" | "SILENCE"; id: string; name: string };
export type SnapshotBlock = { time: string; end: string; name: string | null; target: SnapshotTarget; volume: number | null; priority: number };

export type SkipReason =
  | "local-files"
  | "radio"
  | "source"
  | "not-this-business"
  | "gone"
  | "no-playable-url"
  | "bank-not-open"
  | "unsupported"
  | "closing-kept"
  | "after-closing";

/** the reason, in words a person can read (the screens show these) */
export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  "local-files": "It plays music files that exist only on one computer",
  radio: "A radio station belongs to its own branch and cannot be copied",
  source: "A single source belongs to its own branch and cannot be copied",
  "not-this-business": "It does not belong to this business",
  gone: "It no longer exists",
  "no-playable-url": "It has nothing that can be played from the internet",
  "bank-not-open": "This music bank is not open to this business",
  unsupported: "This kind of block cannot be copied",
  "closing-kept": "The branch keeps its own closing",
  "after-closing": "It starts after this branch closes",
};

export type SkippedBlock = { time: string; name: string | null; targetType: string; targetName: string | null; reason: SkipReason; /** weekdays this applies to, when only some weekdays were left out */ days?: number[] };
export type DaySnapshot = { v: 1; weekday: number; blocks: SnapshotBlock[]; skipped: SkippedBlock[] };

export const isClosingBlock = (b: { targetType: string; name?: string | null }): boolean => b.targetType === "SILENCE" && (b.name ?? "").trim() === CLOSING_BLOCK_NAME;

/** the ENABLED weekly blocks that run on `weekday` — a one-off block is a single date (not part of a weekly day) and a paused block is not part of the day */
export function blocksOfDay<T extends { enabled: boolean; recurrence?: string | null; daysOfWeek: number[] }>(blocks: T[], weekday: number): T[] {
  return blocks.filter((b) => b.enabled && b.recurrence !== "one_off" && Array.isArray(b.daysOfWeek) && b.daysOfWeek.includes(weekday));
}

/**
 * The day of one branch's schedule as an offer carries it (the blocks of `blocksOfDay`, in time order).
 * Per target type: a PLAYLIST of web addresses only is placed; a playlist with any local file, a RADIO station, a SOURCE are listed as "cannot be placed"; a BANK is placed when it is public or opened to the business;
 * SILENCE is copied except the sender's own "Closing" blocks (the receiver keeps its own). Pure — the store hands in the facts.
 */
export function buildDaySnapshot(i: { blocks: DayBlockIn[]; weekday: number; facts: TargetFacts }): DaySnapshot {
  const out: DaySnapshot = { v: 1, weekday: i.weekday, blocks: [], skipped: [] };
  const day = blocksOfDay(i.blocks, i.weekday)
    .map((b) => ({ b, min: timeToMinutes(b.startTimeLocal) ?? 0 }))
    .sort((x, y) => x.min - y.min || String(x.b.name ?? "").localeCompare(String(y.b.name ?? "")) || x.b.id.localeCompare(y.b.id));
  for (const { b } of day) {
    const time = normTime(b.startTimeLocal, "00:00:00");
    const end = normTime(b.endTimeLocal, "23:59:00");
    const name = cleanName(b.name);
    const skip = (reason: SkipReason, targetName: string | null = null) => out.skipped.push({ time, name, targetType: b.targetType, targetName, reason });
    const place = (target: SnapshotTarget) => out.blocks.push({ time, end, name, target, volume: cleanVolume(b.volume), priority: cleanPriority(b.priority) });
    switch (b.targetType) {
      case "SILENCE":
        if (isClosingBlock(b)) skip("closing-kept");
        else place({ type: "SILENCE", id: "silence", name: "Quiet" });
        break;
      case "PLAYLIST": {
        const p = i.facts.playlists[b.targetId];
        if (!p) skip("gone");
        else if (p.workspaceId !== i.facts.workspaceId) skip("not-this-business"); // never even the name of a playlist of another business
        else if (p.hasLocalFiles) skip("local-files", cleanName(p.name));
        else if (!p.hasHttpPlayable) skip("no-playable-url", cleanName(p.name));
        else place({ type: "PLAYLIST", id: b.targetId, name: cleanName(p.name) ?? "Playlist" });
        break;
      }
      case "BANK": {
        const k = i.facts.banks[b.targetId];
        if (!k) skip("bank-not-open");
        else if (!k.open) skip("bank-not-open", cleanName(k.name));
        else place({ type: "BANK", id: b.targetId, name: cleanName(k.name) ?? "Music bank" });
        break;
      }
      case "RADIO":
        skip("radio");
        break;
      case "SOURCE":
        skip("source");
        break;
      default:
        skip("unsupported");
    }
  }
  return out;
}

/** the numbers a sender sees before sending: "7 fit, 2 cannot be placed" */
export function summarizeSnapshot(s: Pick<DaySnapshot, "blocks" | "skipped">): { fits: number; cannot: number; kept: number } {
  const kept = s.skipped.filter((x) => x.reason === "closing-kept").length;
  return { fits: s.blocks.length, cannot: s.skipped.length - kept, kept };
}

/**
 * The offer was made some time ago — before it is applied, every playlist / bank in it is looked at again (it may have gained a local file, been deleted, left the business, a bank may have been closed).
 * A block that no longer qualifies moves to the skipped list with its reason; nothing is lost silently. Pure.
 */
export function revalidateSnapshot(s: DaySnapshot, facts: TargetFacts): DaySnapshot {
  const out: DaySnapshot = { v: 1, weekday: s.weekday, blocks: [], skipped: s.skipped.map((x) => ({ ...x })) };
  for (const b of s.blocks) {
    let reason: SkipReason | null = null;
    let targetName: string | null = b.target.name;
    if (b.target.type === "PLAYLIST") {
      const p = facts.playlists[b.target.id];
      if (!p) reason = "gone";
      else if (p.workspaceId !== facts.workspaceId) { reason = "not-this-business"; targetName = null; }
      else if (p.hasLocalFiles) reason = "local-files";
      else if (!p.hasHttpPlayable) reason = "no-playable-url";
    } else if (b.target.type === "BANK") {
      const k = facts.banks[b.target.id];
      if (!k || !k.open) reason = "bank-not-open";
    } else if (b.target.type !== "SILENCE") {
      reason = "unsupported";
    }
    if (reason) out.skipped.push({ time: b.time, name: b.name, targetType: b.target.type, targetName, reason });
    else out.blocks.push(b);
  }
  return out;
}

// ── 2. sending: who gets an offer, and the caps ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SendSkippedTarget = { branchId: string; reason: "not-a-branch-of-this-business" | "own-branch" | "no-access" | "too-many-waiting" };

export type SendDecision =
  | { ok: true; targets: string[]; skipped: SendSkippedTarget[] }
  | { ok: false; status: 400 | 413; error: string };

/**
 * May this day go out, and to which of the picked branches? (the picking itself — own business, own branch, access — is `pickShareTargets` in lib/playlist-share-rules.ts; this adds the caps.)
 * `pendingByTarget` = offers already waiting for each branch (counted in the database). A branch with 20 waiting is skipped (listed), not an error for the others.
 */
export function decideSend(i: { targets: string[]; skipped: SendSkippedTarget[]; blockCount: number; fitCount: number; pendingByTarget: Record<string, number> }): SendDecision {
  if (i.blockCount > DAY_SHARE_LIMITS.MAX_BLOCKS) return { ok: false, status: 413, error: `A day of more than ${DAY_SHARE_LIMITS.MAX_BLOCKS} blocks cannot be sent` };
  if (i.targets.length > DAY_SHARE_LIMITS.MAX_TARGET_BRANCHES) return { ok: false, status: 413, error: `A day can be sent to at most ${DAY_SHARE_LIMITS.MAX_TARGET_BRANCHES} branches at once` };
  if (i.targets.length === 0) return { ok: false, status: 400, error: "No branch to send to" };
  if (i.fitCount === 0) return { ok: false, status: 400, error: "Nothing in this day can be placed on another branch" };
  const skipped = [...i.skipped];
  const targets: string[] = [];
  for (const t of i.targets) {
    if ((i.pendingByTarget[t] ?? 0) >= DAY_SHARE_LIMITS.MAX_PENDING_PER_TARGET) skipped.push({ branchId: t, reason: "too-many-waiting" });
    else targets.push(t);
  }
  if (targets.length === 0) return { ok: false, status: 400, error: "No branch to send to", };
  return { ok: true, targets, skipped };
}

// ── 3. answering an offer ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type DayShareDecision = { ok: true; status: DayShareStatus } | { ok: false; status: 400 | 403 | 409 | 410; error: string };

/** is the PENDING offer past its date? */
export const isExpired = (expiresAt: Date | string, now: Date): boolean => new Date(expiresAt).getTime() <= now.getTime();

/** may an accepted offer still be undone? (14 days from the moment it was accepted) */
export const isUndoable = (decidedAt: Date | string | null, now: Date): boolean => !!decidedAt && now.getTime() - new Date(decidedAt).getTime() <= DAY_SHARE_LIMITS.UNDO_DAYS * DAY_MS;

/** What an action does to an offer. `isSender`: the person who sent it; `canUseTarget`: may the asker use the RECEIVING branch. Only the sender takes a PENDING offer back; only someone who may use the receiving branch answers or undoes it. */
export function decideDayShareAction(i: { current: DayShareStatus; action: DayShareAction; isSender: boolean; canUseTarget: boolean; expired: boolean; undoable: boolean }): DayShareDecision {
  const { current, action } = i;
  if (action === "revoke") {
    if (!i.isSender) return { ok: false, status: 403, error: "Only the person who sent it can take an offer back" };
    if (current === "PENDING") return { ok: true, status: "REVOKED" };
    if (current === "ACCEPTED") return { ok: false, status: 409, error: "This offer was already accepted — the branch can undo it" };
    return { ok: false, status: 409, error: "This offer is already closed" };
  }
  if (!i.canUseTarget) return { ok: false, status: 403, error: "Forbidden: no access to this branch" };
  if (current === "REVOKED") return { ok: false, status: 409, error: "The sender took this offer back" };
  if (action === "accept" || action === "preview") {
    if (current !== "PENDING") return { ok: false, status: 409, error: "This offer is not waiting for an answer" };
    if (i.expired) return { ok: false, status: 410, error: "This offer has expired" };
    return { ok: true, status: action === "accept" ? "ACCEPTED" : "PENDING" };
  }
  if (action === "decline") return current === "PENDING" ? { ok: true, status: "DECLINED" } : { ok: false, status: 409, error: "This offer is not waiting for an answer" };
  if (action === "undo") {
    if (current !== "ACCEPTED") return { ok: false, status: 409, error: "There is nothing to undo" };
    if (!i.undoable) return { ok: false, status: 409, error: `The ${DAY_SHARE_LIMITS.UNDO_DAYS}-day window for undoing this offer is over` };
    return { ok: true, status: "UNDONE" };
  }
  return { ok: false, status: 400, error: "Unknown action" };
}

// ── 4. applying an accepted offer to the receiving branch ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type TargetBlockIn = {
  id: string;
  name?: string | null;
  targetType: string;
  startTimeLocal: string;
  enabled: boolean;
  recurrence?: string | null;
  daysOfWeek: number[];
  oneOffDateLocal?: string | null;
  skipDates?: string[];
};

export type ApplyInput = { mode: ApplyMode; weekdays?: number[]; date?: string; conflict?: ConflictMode };

/** one Schedule row to create (the store adds ids, workspace, branch, who, the stamp) — copies time, end, name, volume and priority; sets NO timezone */
export type NewRow = {
  name: string | null;
  targetType: "PLAYLIST" | "BANK" | "SILENCE";
  targetId: string;
  startTimeLocal: string;
  endTimeLocal: string;
  volume: number | null;
  priority: number;
  recurrence: "weekly" | "one_off";
  daysOfWeek: number[];
  oneOffDateLocal: string | null;
};

/** a change to a block the receiving branch already had */
export type Edit = { id: string; kind: "remove-weekdays"; days: number[]; disable: boolean } | { id: string; kind: "skip-date"; date: string };

export type Conflict = { id: string; name: string | null; time: string; kind: "replaced" | "tie"; days?: number[]; date?: string };
export type Warning = { code: "today"; text: string };

export type Plan =
  | { ok: true; rows: NewRow[]; edits: Edit[]; skipped: SkippedBlock[]; conflicts: Conflict[]; warnings: Warning[]; applied: { mode: ApplyMode; weekdays: number[]; date: string | null; conflict: ConflictMode } }
  | { ok: false; status: 400 | 422; error: string };

/** does an existing block of the receiving branch run on this weekday / date? (active blocks only; a block switched off for that date does not) */
function runsOn(b: TargetBlockIn, day: { weekday: number; date: string | null }): boolean {
  if (!b.enabled) return false;
  if (day.date && (b.skipDates ?? []).includes(day.date)) return false;
  if (b.recurrence === "one_off") return !!day.date && b.oneOffDateLocal === day.date;
  return Array.isArray(b.daysOfWeek) && b.daysOfWeek.includes(day.weekday);
}

/**
 * The minute from which the receiving branch is closed on a day (null = no closing applies). A closing is one of the branch's own quiet "Closing" blocks that comes AFTER the branch opens: the opening is the
 * start of the branch's own first music block of that day, or — when it has none — of the first copied block. (A "Closing" at 00:00 / 02:00 that ends yesterday's evening is therefore not a cut: the day opens after it.)
 */
export function closingCut(i: { target: TargetBlockIn[]; day: { weekday: number; date: string | null }; firstCopiedStart: number }): number | null {
  const onDay = i.target.filter((b) => runsOn(b, i.day));
  const own = onDay.filter((b) => b.targetType !== "SILENCE").map((b) => timeToMinutes(b.startTimeLocal)).filter((m): m is number => m !== null);
  const open = own.length > 0 ? Math.min(...own) : i.firstCopiedStart;
  const closings = onDay.filter((b) => isClosingBlock(b)).map((b) => timeToMinutes(b.startTimeLocal)).filter((m): m is number => m !== null && m > open);
  return closings.length > 0 ? Math.min(...closings) : null;
}

/**
 * What accepting does, worked out without touching anything (also the dry run the receiving branch sees before it answers). Pure.
 *   · mode "weekday": weekly blocks on `weekdays` (default: the day that was sent); "date": one-off blocks on one calendar date (not in the past; a margin of one day covers the branch's own clock);
 *   · conflict "replace" (default): the receiving branch's own blocks of that day are switched off — a weekly block loses that weekday (disabled when none is left), a date gets a skip-date on each active block; the
 *     branch's own "Closing" blocks stay; only days on which something is actually placed are replaced. "alongside": nothing is changed, same-minute ties are flagged;
 *   · a block that starts at or after the branch's closing is skipped and listed; with several weekdays it is placed only on the weekdays where it is before the closing;
 *   · nothing can be placed → refused 422 (the offer stays as it is).
 */
export function planApply(i: { snapshot: DaySnapshot; input: ApplyInput; target: TargetBlockIn[]; now: Date }): Plan {
  const conflict: ConflictMode = i.input.conflict === "alongside" ? "alongside" : "replace";
  const today = ymdOf(i.now);
  let weekdays: number[];
  let date: string | null = null;
  if (i.input.mode === "date") {
    if (!isYmd(i.input.date)) return { ok: false, status: 400, error: "Choose a calendar date" };
    if (i.input.date < addDaysYmd(today, -1)) return { ok: false, status: 400, error: "That date is in the past" };
    date = i.input.date;
    weekdays = [weekdayOfYmd(date)];
  } else if (i.input.mode === "weekday") {
    const asked = i.input.weekdays === undefined ? [i.snapshot.weekday] : i.input.weekdays;
    if (!Array.isArray(asked) || asked.length === 0 || !asked.every(isWeekday)) return { ok: false, status: 400, error: "Choose the weekdays (0 = Sunday … 6 = Saturday)" };
    weekdays = [...new Set(asked)].sort((a, b) => a - b);
  } else {
    return { ok: false, status: 400, error: "Choose how to place it: a weekday routine or one date" };
  }

  const warnings: Warning[] = [];
  if ((date !== null && date === today) || (date === null && weekdays.includes(i.now.getDay()))) {
    warnings.push({ code: "today", text: "This applies to today — a block whose time has passed will not start, and one that is due now may start at once" });
  }

  const skipped: SkippedBlock[] = i.snapshot.skipped.map((s) => ({ ...s }));
  const first = i.snapshot.blocks.map((b) => timeToMinutes(b.time)).filter((m): m is number => m !== null);
  const firstCopied = first.length > 0 ? Math.min(...first) : 0;
  const cuts = new Map<number, number | null>();
  for (const w of weekdays) cuts.set(w, closingCut({ target: i.target, day: { weekday: w, date }, firstCopiedStart: firstCopied }));

  const rows: NewRow[] = [];
  for (const b of i.snapshot.blocks) {
    const start = timeToMinutes(b.time) ?? 0;
    const allowed = weekdays.filter((w) => {
      const cut = cuts.get(w) ?? null;
      return cut === null || start < cut;
    });
    if (allowed.length < weekdays.length) {
      skipped.push({ time: b.time, name: b.name, targetType: b.target.type, targetName: b.target.name, reason: "after-closing", ...(allowed.length > 0 ? { days: weekdays.filter((w) => !allowed.includes(w)) } : {}) });
    }
    if (allowed.length === 0) continue;
    rows.push({
      name: b.name,
      targetType: b.target.type,
      targetId: b.target.id,
      startTimeLocal: b.time,
      endTimeLocal: b.end,
      volume: b.volume,
      priority: b.priority,
      recurrence: date ? "one_off" : "weekly",
      daysOfWeek: date ? [] : allowed,
      oneOffDateLocal: date,
    });
  }
  if (rows.length === 0) return { ok: false, status: 422, error: "Nothing in this offer can be placed on this branch" };

  const edits: Edit[] = [];
  const conflicts: Conflict[] = [];
  const placedDays = [...new Set(rows.flatMap((r) => r.daysOfWeek))].sort((a, b) => a - b);
  if (conflict === "replace") {
    for (const b of i.target) {
      if (!b.enabled || isClosingBlock(b)) continue;
      const time = normTime(b.startTimeLocal, "00:00:00");
      if (date) {
        if (!runsOn(b, { weekday: weekdays[0]!, date })) continue; // not on that date, or already switched off for it
        edits.push({ id: b.id, kind: "skip-date", date });
        conflicts.push({ id: b.id, name: cleanName(b.name), time, kind: "replaced", date });
      } else if (b.recurrence !== "one_off" && Array.isArray(b.daysOfWeek)) {
        const hit = b.daysOfWeek.filter((d) => placedDays.includes(d));
        if (hit.length === 0) continue;
        edits.push({ id: b.id, kind: "remove-weekdays", days: hit, disable: hit.length >= new Set(b.daysOfWeek).size });
        conflicts.push({ id: b.id, name: cleanName(b.name), time, kind: "replaced", days: hit });
      }
    }
  } else {
    // alongside: only flag the blocks that would start in the very same minute (the engine breaks such a tie by priority, then id)
    for (const r of rows) {
      const m = timeToMinutes(r.startTimeLocal);
      for (const b of i.target) {
        if (isClosingBlock(b) || timeToMinutes(b.startTimeLocal) !== m) continue;
        const days = r.recurrence === "one_off" ? [weekdays[0]!] : r.daysOfWeek;
        if (days.some((w) => runsOn(b, { weekday: w, date: r.oneOffDateLocal }))) conflicts.push({ id: b.id, name: cleanName(b.name), time: r.startTimeLocal, kind: "tie" });
      }
    }
  }
  return { ok: true, rows, edits, skipped, conflicts, warnings, applied: { mode: date ? "date" : "weekday", weekdays, date, conflict } };
}

/** the block's tags after an edit that adds the date to its skip dates (every other tag is kept) — what the store writes */
export function tagsAfterSkip(tags: unknown, date: string, today: string): unknown {
  return tagsWithSkipDates(tags, [...skipDatesFromTags(tags), date], today);
}

/** the tag every created block carries */
export const dayCopyTag = (batchId: string): { key: string; value: string } => ({ key: DAY_COPY_TAG_KEY, value: batchId });
