import { randomUUID } from "node:crypto";
import { Prisma, type Schedule as ScheduleRow, type ScheduleDayShare as OfferRowPlain } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPlaylist } from "@/lib/playlist-store";
import { playlistHasHttpPlayableUrl, playlistHasLocalFiles } from "@/lib/playlist-playability";
import { canonicalizeLegacyBranch, getCanonicalLegacyBranchId, legacyBranchEquivalents } from "@/lib/branch-resolver";
import { sameBranch } from "@/lib/local-playlist-branch";
import { accessiblePrivateBanks } from "@/lib/music-bank/bank-access";
import { POC_MUSIC_BANK_CATALOG } from "@/lib/music-bank/poc-catalog";
import { creatorDisplayName } from "@/lib/playlist-credit";
import { pickShareTargets } from "@/lib/playlist-share-rules";
import { createAcceptedBranchSharesTx, revokeSharesByIdsTx, workspaceBranchIds } from "@/lib/playlist-share-store";
import { skipDatesFromTags, ymdOf } from "@/lib/schedule-skip";
import { writeTenantAuditLog } from "@/lib/admin/tenant-audit";
import {
  DAY_SHARE_LIMITS,
  blocksOfDay,
  buildDaySnapshot,
  dayCopyTag,
  decideDayShareAction,
  decideSend,
  isExpired,
  isUndoable,
  planApply,
  revalidateSnapshot,
  summarizeSnapshot,
  tagsAfterSkip,
  type ApplyInput,
  type ApplyMode,
  type Conflict,
  type ConflictMode,
  type DayBlockIn,
  type DayShareAction,
  type DayShareStatus,
  type DaySnapshot,
  type SendSkippedTarget,
  type SkippedBlock,
  type SnapshotBlock,
  type TargetBlockIn,
  type TargetFacts,
  type Warning,
} from "@/lib/schedule-day-share-rules";

/**
 * Sending one day of a branch's schedule to the other branches of the SAME business — the store (owner 2026-11-25, phase 1). THE ONLY FILE THAT TOUCHES THE `ScheduleDayShare` TABLE.
 * Every query is fenced to ONE workspace (the caller's): the offer, both branches and every playlist / bank the day plays must belong to it. Server only. Who may ask (OWNER, access to a branch) is decided by the routes;
 * what is allowed is decided by lib/schedule-day-share-rules.ts (pure).
 *
 * The rows an accept creates are made HERE, by a dedicated write (NOT store.addSchedule, which would upsert a junk Branch row for an unknown branch id): they get preset ids, are stamped
 * taxonomyTags {key:"day-copy", value:<batchId>}, and the whole accept — status change, new rows, changes to the branch's own blocks, the playlist shares — is ONE transaction. The status is changed with a
 * compare-and-set (WHERE status = 'PENDING'), so a double click / double request applies once. UNDO deletes a created row only if it was not edited since (compare-and-set on updatedAt) and restores the
 * blocks that were changed from their before-images; whatever was edited since stays and is listed — nothing is thrown away silently.
 */

export type Fail = { ok: false; status: number; error: string };
const fail = (status: number, error: string): Fail => ({ ok: false, status, error });

class DayShareFail extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// ── what a caller reads ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AcceptResult = {
  created: { id: string; time: string; end: string; name: string | null; target: SnapshotBlock["target"]; days: number[]; date: string | null }[];
  replaced: Conflict[];
  ties: Conflict[];
  skipped: SkippedBlock[];
  warnings: Warning[];
  applied: { mode: ApplyMode; weekdays: number[]; date: string | null; conflict: ConflictMode };
  sharesCreated: number;
};

export type UndoResult = {
  removed: number;
  leftInPlace: { id: string; reason: "edited-since" }[];
  restored: number;
  notRestored: { id: string; reason: "edited-since" | "gone" }[];
  sharesRevoked: number;
  sharesKept: number;
};

export type OfferView = {
  id: string;
  fromBranchId: string;
  targetBranchId: string;
  fromUserId: string;
  fromName: string | null;
  sourceWeekday: number;
  status: DayShareStatus;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
  undoneAt: string | null;
  /** accepted offers can be undone until this moment */
  undoableUntil: string | null;
  summary: { fits: number; cannot: number; kept: number };
  /** WHITELISTED: the day as the sender saw it — never a file path or address of a local file, never the ledger */
  blocks: SnapshotBlock[];
  skipped: SkippedBlock[];
  applied: { mode: ApplyMode; weekdays: number[]; date: string | null } | null;
  result: AcceptResult | null;
  undo: UndoResult | null;
};

type Ledger = {
  batchId: string;
  created: { id: string; updatedAt: string }[];
  touched: { id: string; before: { enabled: boolean; daysOfWeek: number[]; taxonomyTags: unknown; updatedBy: string | null }; afterUpdatedAt: string }[];
  sharesCreated: { id: string; playlistId: string }[];
  sharesExisting: { playlistId: string }[];
  result: AcceptResult;
  undo?: UndoResult;
};

const OFFER_INCLUDE = { fromUser: { select: { name: true, firstName: true, lastName: true } } } as const;
type OfferRow = Prisma.ScheduleDayShareGetPayload<{ include: typeof OFFER_INCLUDE }>;

function parseSnapshot(raw: unknown): DaySnapshot | null {
  const s = raw as Partial<DaySnapshot> | null;
  if (!s || s.v !== 1 || !Array.isArray(s.blocks) || !Array.isArray(s.skipped) || typeof s.weekday !== "number") return null;
  return s as DaySnapshot;
}

function toView(row: OfferRow): OfferView {
  const snap = parseSnapshot(row.snapshot) ?? { v: 1 as const, weekday: row.sourceWeekday, blocks: [], skipped: [] };
  const ledger = (row.ledger ?? null) as Ledger | null;
  const decided = row.decidedAt ? new Date(row.decidedAt.getTime() + DAY_SHARE_LIMITS.UNDO_DAYS * 24 * 60 * 60 * 1000).toISOString() : null;
  return {
    id: row.id,
    fromBranchId: row.fromBranchId,
    targetBranchId: row.targetBranchId,
    fromUserId: row.fromUserId,
    fromName: creatorDisplayName(row.fromUser) ?? null,
    sourceWeekday: row.sourceWeekday,
    status: row.status as DayShareStatus,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    undoneAt: row.undoneAt ? row.undoneAt.toISOString() : null,
    undoableUntil: row.status === "ACCEPTED" ? decided : null,
    summary: summarizeSnapshot(snap),
    blocks: snap.blocks,
    skipped: snap.skipped,
    applied: row.appliedMode ? { mode: row.appliedMode as ApplyMode, weekdays: row.appliedWeekdays ?? [], date: row.appliedDate ?? null } : null,
    result: ledger?.result ?? null,
    undo: ledger?.undo ?? null,
  };
}

// ── helpers: branches, schedules, facts ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** the real branch id (the legacy key "default" → the business's canonical branch), only when it is a branch of THIS business */
async function resolveBranchInWorkspace(workspaceId: string, raw: string): Promise<string | null> {
  const canonical = await getCanonicalLegacyBranchId(workspaceId);
  const id = canonicalizeLegacyBranch(raw, canonical);
  const row = await prisma.branch.findFirst({ where: { id, workspaceId }, select: { id: true } });
  return row?.id ?? null;
}

/** the schedules of ONE branch — the EXACT canonical-branch match (the branch's id and its legacy-key alias), never the fail-open orphan behaviour of lib/schedule-branch-scope.ts */
async function branchSchedules(client: Prisma.TransactionClient | typeof prisma, workspaceId: string, branchId: string): Promise<ScheduleRow[]> {
  const canonical = await getCanonicalLegacyBranchId(workspaceId);
  return client.schedule.findMany({ where: { workspaceId, branchId: { in: legacyBranchEquivalents(branchId, canonical) } } });
}

const asDayBlock = (r: ScheduleRow): DayBlockIn => ({
  id: r.id, name: r.name, targetType: r.targetType, targetId: r.targetId, startTimeLocal: r.startTimeLocal, endTimeLocal: r.endTimeLocal,
  volume: r.volume, priority: r.priority, enabled: r.enabled, recurrence: r.recurrence, daysOfWeek: r.daysOfWeek,
});
const asTargetBlock = (r: ScheduleRow): TargetBlockIn => ({
  id: r.id, name: r.name, targetType: r.targetType, startTimeLocal: r.startTimeLocal, enabled: r.enabled, recurrence: r.recurrence,
  daysOfWeek: r.daysOfWeek, oneOffDateLocal: r.oneOffDateLocal, skipDates: skipDatesFromTags(r.taxonomyTags),
});

/** What the server knows about the playlists / banks a day plays. A playlist of ANOTHER business is never loaded (only its owner is looked at), so nothing of it can leak into an offer. */
async function loadFacts(workspaceId: string, items: { targetType: string; targetId: string }[]): Promise<TargetFacts> {
  const facts: TargetFacts = { workspaceId, playlists: {}, banks: {} };
  const playlistIds = [...new Set(items.filter((x) => x.targetType === "PLAYLIST" && x.targetId).map((x) => x.targetId))];
  const bankIds = [...new Set(items.filter((x) => x.targetType === "BANK" && x.targetId).map((x) => x.targetId))];
  await Promise.all(
    playlistIds.map(async (id) => {
      const owner = await prisma.playlist.findUnique({ where: { id }, select: { workspaceId: true } });
      if (!owner) return;
      if (owner.workspaceId !== workspaceId) {
        facts.playlists[id] = { name: "", workspaceId: owner.workspaceId, branchId: null, hasLocalFiles: false, hasHttpPlayable: false };
        return;
      }
      const p = await getPlaylist(id);
      if (!p) return;
      facts.playlists[id] = { name: p.name, workspaceId: owner.workspaceId, branchId: p.branchId ?? null, hasLocalFiles: playlistHasLocalFiles(p), hasHttpPlayable: playlistHasHttpPlayableUrl(p) };
    }),
  );
  if (bankIds.length > 0) {
    const open = bankIds.some((id) => !POC_MUSIC_BANK_CATALOG.genres.some((g) => g.id === id)) ? await accessiblePrivateBanks({ workspaceId }) : [];
    for (const id of bankIds) {
      const pub = POC_MUSIC_BANK_CATALOG.genres.find((g) => g.id === id);
      const priv = open.find((b) => b.id === id);
      if (pub) facts.banks[id] = { name: pub.name, open: true };
      else if (priv) facts.banks[id] = { name: priv.name, open: true };
    }
  }
  return facts;
}

// ── 1. preview + send ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type SendInput = {
  workspaceId: string;
  userId: string;
  fromBranchId: string;
  weekday: number;
  requested: string[] | "all";
  /** the branches the caller may use ("*" = all) */
  access: string[];
  requestId: string;
  ip?: string | null;
  now?: Date;
};

export type PreviewResult = {
  ok: true;
  fromBranchId: string;
  weekday: number;
  summary: { fits: number; cannot: number; kept: number };
  blocks: SnapshotBlock[];
  skipped: SkippedBlock[];
  targets: string[];
  skippedTargets: SendSkippedTarget[];
};

async function prepareDay(i: Omit<SendInput, "userId" | "requestId" | "ip">, now: Date): Promise<(PreviewResult & { snapshot: DaySnapshot }) | Fail> {
  if (!Number.isInteger(i.weekday) || i.weekday < 0 || i.weekday > 6) return fail(400, "weekday must be 0 (Sunday) to 6 (Saturday)");
  if (i.requested !== "all" && i.requested.length > 500) return fail(413, "Too many branches in one request");
  const fromBranch = await resolveBranchInWorkspace(i.workspaceId, i.fromBranchId);
  if (!fromBranch) return fail(404, "Branch not found");

  const rows = await branchSchedules(prisma, i.workspaceId, fromBranch);
  const dayCount = blocksOfDay(rows.map(asDayBlock), i.weekday).length;
  if (dayCount > DAY_SHARE_LIMITS.MAX_BLOCKS) return fail(413, `A day of more than ${DAY_SHARE_LIMITS.MAX_BLOCKS} blocks cannot be sent`);
  const facts = await loadFacts(i.workspaceId, rows.filter((r) => r.enabled).map((r) => ({ targetType: r.targetType, targetId: r.targetId })));
  const snapshot = buildDaySnapshot({ blocks: rows.map(asDayBlock), weekday: i.weekday, facts });

  const [wsBranches, canonical] = await Promise.all([workspaceBranchIds(i.workspaceId), getCanonicalLegacyBranchId(i.workspaceId)]);
  const picked = pickShareTargets({ playlistBranch: fromBranch, canonicalDefaultBranchId: canonical, requested: i.requested, workspaceBranchIds: wsBranches, access: i.access });
  const grouped = picked.targets.length > 0
    ? await prisma.scheduleDayShare.groupBy({ by: ["targetBranchId"], where: { workspaceId: i.workspaceId, targetBranchId: { in: picked.targets }, status: "PENDING", expiresAt: { gt: now } }, _count: { _all: true } })
    : [];
  const pending: Record<string, number> = {};
  for (const g of grouped) pending[g.targetBranchId] = g._count._all;
  const decision = decideSend({ targets: picked.targets, skipped: picked.skipped, blockCount: dayCount, fitCount: snapshot.blocks.length, pendingByTarget: pending });
  if (!decision.ok) return fail(decision.status, decision.error);
  return { ok: true, fromBranchId: fromBranch, weekday: i.weekday, summary: summarizeSnapshot(snapshot), blocks: snapshot.blocks, skipped: snapshot.skipped, targets: decision.targets, skippedTargets: decision.skipped, snapshot };
}

/** Dry run of a send: "7 fit, 2 cannot be placed" with the reasons, and who would get it. Writes nothing. */
export async function previewSend(i: Omit<SendInput, "userId" | "requestId" | "ip">): Promise<PreviewResult | Fail> {
  const p = await prepareDay(i, i.now ?? new Date());
  if (!p.ok) return p;
  return { ok: true, fromBranchId: p.fromBranchId, weekday: p.weekday, summary: p.summary, blocks: p.blocks, skipped: p.skipped, targets: p.targets, skippedTargets: p.skippedTargets };
}

export type SendResult = { ok: true; created: OfferView[]; alreadySent: OfferView[]; skippedTargets: SendSkippedTarget[]; summary: { fits: number; cannot: number; kept: number }; skipped: SkippedBlock[] };

/** Makes one PENDING offer per target branch. Idempotent by `requestId` (one key per target: "<workspace>:<key>#<branch>") — a retry / double click returns the offers it already made. */
export async function sendOffers(i: SendInput): Promise<SendResult | Fail> {
  const now = i.now ?? new Date();
  const p = await prepareDay(i, now);
  if (!p.ok) return p;
  const keyOf = (branchId: string) => `${i.workspaceId}:${i.requestId}#${branchId}`;
  const findExisting = () => prisma.scheduleDayShare.findMany({ where: { workspaceId: i.workspaceId, requestId: { in: p.targets.map(keyOf) } }, include: OFFER_INCLUDE });

  const existing = await findExisting();
  const have = new Set(existing.map((e) => e.targetBranchId));
  const fresh = p.targets.filter((t) => !have.has(t));
  let created: OfferRow[] = [];
  let already = existing;
  if (fresh.length > 0) {
    try {
      created = await prisma.$transaction(async (tx) => {
        const out: OfferRow[] = [];
        for (const targetBranchId of fresh) {
          const row = await tx.scheduleDayShare.create({
            data: {
              workspaceId: i.workspaceId,
              fromBranchId: p.fromBranchId,
              targetBranchId,
              targetKind: "BRANCH",
              fromUserId: i.userId,
              sourceWeekday: i.weekday,
              status: "PENDING",
              requestId: keyOf(targetBranchId),
              snapshot: p.snapshot as unknown as Prisma.InputJsonValue,
              expiresAt: new Date(now.getTime() + DAY_SHARE_LIMITS.OFFER_TTL_DAYS * 24 * 60 * 60 * 1000),
            },
            include: OFFER_INCLUDE,
          });
          await writeTenantAuditLog(tx, {
            action: "schedule_day_share.send",
            entity: "schedule_day_share",
            actorUserId: i.userId,
            workspaceId: i.workspaceId,
            targetUserId: row.id,
            ipAddress: i.ip ?? null,
            metadata: { fromBranchId: p.fromBranchId, targetBranchId, weekday: i.weekday, fits: p.summary.fits, cannot: p.summary.cannot },
          });
          out.push(row);
        }
        return out;
      });
    } catch (e) {
      // two identical requests at once: the other one won — answer with what it made
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        created = [];
        already = await findExisting();
      } else {
        throw e;
      }
    }
  }
  return { ok: true, created: created.map(toView), alreadySent: already.map(toView), skippedTargets: p.skippedTargets, summary: p.summary, skipped: p.skipped };
}

// ── 2. reading offers ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Offers aimed at these branches (`"*"` = every branch of the workspace), or — with `sentBy` — the ones this person sent. A PENDING offer past its date is not listed. */
export async function listOffers(i: { workspaceId: string; branchIds: string[] | "*"; statuses: DayShareStatus[]; sentBy?: string; now?: Date }): Promise<OfferView[]> {
  const now = i.now ?? new Date();
  const others = i.statuses.filter((s) => s !== "PENDING");
  const or: Prisma.ScheduleDayShareWhereInput[] = [];
  if (others.length > 0) or.push({ status: { in: others } });
  if (i.statuses.includes("PENDING")) or.push({ status: "PENDING", expiresAt: { gt: now } });
  if (or.length === 0) return [];
  const rows = await prisma.scheduleDayShare.findMany({
    where: {
      workspaceId: i.workspaceId,
      targetKind: "BRANCH",
      OR: or,
      ...(i.sentBy ? { fromUserId: i.sentBy } : i.branchIds === "*" ? {} : { targetBranchId: { in: i.branchIds } }),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: OFFER_INCLUDE,
  });
  return rows.map(toView);
}

/** One offer, only inside the caller's workspace — just what a route needs to decide who may answer. */
export async function getOfferInWorkspace(workspaceId: string, offerId: string): Promise<{ id: string; targetBranchId: string; fromUserId: string; status: DayShareStatus } | null> {
  const row = await prisma.scheduleDayShare.findFirst({ where: { id: offerId, workspaceId, targetKind: "BRANCH" }, select: { id: true, targetBranchId: true, fromUserId: true, status: true } });
  return row ? { ...row, status: row.status as DayShareStatus } : null;
}

// ── 3. answering ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type AnswerInput = {
  workspaceId: string;
  userId: string;
  offerId: string;
  action: DayShareAction;
  /** the route's answer to "may this person use the RECEIVING branch" */
  canUseTarget: boolean;
  apply?: ApplyInput;
  ip?: string | null;
  now?: Date;
};

export type AnswerResult =
  | { ok: true; status: DayShareStatus; result?: AcceptResult; undo?: UndoResult; preview?: { willPlace: SnapshotBlock[]; skipped: SkippedBlock[]; replaced: Conflict[]; ties: Conflict[]; warnings: Warning[]; applied: AcceptResult["applied"] } }
  | Fail;

export async function answerOffer(i: AnswerInput): Promise<AnswerResult> {
  const now = i.now ?? new Date();
  const offer = await prisma.scheduleDayShare.findFirst({ where: { id: i.offerId, workspaceId: i.workspaceId, targetKind: "BRANCH" } });
  if (!offer) return fail(404, "Offer not found");
  const decision = decideDayShareAction({
    current: offer.status as DayShareStatus,
    action: i.action,
    isSender: offer.fromUserId === i.userId,
    canUseTarget: i.canUseTarget,
    expired: isExpired(offer.expiresAt, now),
    undoable: isUndoable(offer.decidedAt, now),
  });
  if (!decision.ok) return fail(decision.status, decision.error);

  try {
    if (i.action === "decline" || i.action === "revoke") {
      await prisma.$transaction(async (tx) => {
        const cas = await tx.scheduleDayShare.updateMany({ where: { id: offer.id, workspaceId: i.workspaceId, status: "PENDING" }, data: { status: decision.status, decidedAt: now } });
        if (cas.count !== 1) throw new DayShareFail(409, "This offer was already answered");
        await writeTenantAuditLog(tx, {
          action: i.action === "revoke" ? "schedule_day_share.revoke" : "schedule_day_share.answer",
          entity: "schedule_day_share", actorUserId: i.userId, workspaceId: i.workspaceId, targetUserId: offer.id, ipAddress: i.ip ?? null,
          metadata: { action: i.action, fromBranchId: offer.fromBranchId, targetBranchId: offer.targetBranchId },
        });
      });
      return { ok: true, status: decision.status };
    }
    if (i.action === "undo") return await undoOffer(i, offer, now);
    return await acceptOrPreview(i, offer, now);
  } catch (e) {
    if (e instanceof DayShareFail) return fail(e.status, e.message);
    throw e;
  }
}

async function acceptOrPreview(i: AnswerInput, offer: OfferRowPlain, now: Date): Promise<AnswerResult> {
  const { workspaceId, userId } = i;
  const target = await prisma.branch.findFirst({ where: { id: offer.targetBranchId, workspaceId }, select: { id: true } });
  if (!target) return fail(404, "Branch not found");
  const snapshot = parseSnapshot(offer.snapshot);
  if (!snapshot) return fail(500, "This offer cannot be read");
  if (!i.apply) return fail(400, "Choose how to place it: a weekday routine or one date");

  // everything the day plays is looked at again NOW (it may have changed since the offer was made)
  const facts = await loadFacts(workspaceId, snapshot.blocks.map((b) => ({ targetType: b.target.type, targetId: b.target.id })));
  const fresh = revalidateSnapshot(snapshot, facts);

  if (i.action === "preview") {
    const plan = planApply({ snapshot: fresh, input: i.apply, target: (await branchSchedules(prisma, workspaceId, offer.targetBranchId)).map(asTargetBlock), now });
    if (!plan.ok) return fail(plan.status, plan.error);
    return {
      ok: true,
      status: "PENDING",
      preview: {
        willPlace: plan.rows.map((r) => ({ time: r.startTimeLocal, end: r.endTimeLocal, name: r.name, target: { type: r.targetType, id: r.targetId, name: fresh.blocks.find((b) => b.target.id === r.targetId)?.target.name ?? "" }, volume: r.volume, priority: r.priority })),
        skipped: plan.skipped,
        replaced: plan.conflicts.filter((c) => c.kind === "replaced"),
        ties: plan.conflicts.filter((c) => c.kind === "tie"),
        warnings: plan.warnings,
        applied: plan.applied,
      },
    };
  }

  const canonical = await getCanonicalLegacyBranchId(workspaceId);
  const tx = await prisma.$transaction(
    async (tx) => {
      // the target's own blocks are read INSIDE the transaction, so the plan is made on what is really there
      const targetRows = await branchSchedules(tx, workspaceId, offer.targetBranchId);
      const plan = planApply({ snapshot: fresh, input: i.apply!, target: targetRows.map(asTargetBlock), now });
      if (!plan.ok) throw new DayShareFail(plan.status, plan.error);

      // 1) the answer is given ONCE: compare-and-set the status (a double click / a second request finds it already answered)
      const cas = await tx.scheduleDayShare.updateMany({
        where: { id: offer.id, workspaceId, status: "PENDING", expiresAt: { gt: now } },
        data: { status: "ACCEPTED", decidedAt: now, appliedMode: plan.applied.mode, appliedWeekdays: plan.applied.weekdays, appliedDate: plan.applied.date },
      });
      if (cas.count !== 1) throw new DayShareFail(409, "This offer was already answered");

      // 2) the new rows — a dedicated write (no Branch upsert), preset ids, stamped with the batch
      const batchId = randomUUID();
      const ids = plan.rows.map(() => randomUUID());
      await tx.schedule.createMany({
        data: plan.rows.map((r, n) => ({
          id: ids[n]!,
          workspaceId,
          branchId: offer.targetBranchId,
          name: r.name,
          targetType: r.targetType,
          targetId: r.targetId,
          sourceId: null,
          recurrence: r.recurrence,
          oneOffDateLocal: r.oneOffDateLocal,
          daysOfWeek: r.daysOfWeek,
          startTimeLocal: r.startTimeLocal,
          endTimeLocal: r.endTimeLocal,
          enabled: true,
          priority: r.priority,
          volume: r.volume,
          createdBy: userId,
          taxonomyTags: [dayCopyTag(batchId)] as Prisma.InputJsonValue,
          // NO timezone: the engine runs on the player's own clock (lib/schedule-window.ts)
        })),
      });
      const made = await tx.schedule.findMany({ where: { id: { in: ids }, workspaceId }, select: { id: true, updatedAt: true } });
      const stamp = new Map(made.map((m) => [m.id, m.updatedAt.toISOString()]));

      // 3) the branch's own blocks that the day replaces: changed in place (never deleted), with a before-image for the undo
      const touched: Ledger["touched"] = [];
      for (const e of plan.edits) {
        const row = targetRows.find((r) => r.id === e.id);
        if (!row) continue;
        const before = { enabled: row.enabled, daysOfWeek: row.daysOfWeek, taxonomyTags: row.taxonomyTags ?? null, updatedBy: row.updatedBy ?? null };
        const data: Prisma.ScheduleUpdateManyMutationInput =
          e.kind === "skip-date"
            ? { taxonomyTags: tagsAfterSkip(row.taxonomyTags, e.date, ymdOf(now)) as Prisma.InputJsonValue, updatedBy: userId }
            : e.disable
              ? { enabled: false, updatedBy: userId }
              : { daysOfWeek: row.daysOfWeek.filter((d) => !e.days.includes(d)), updatedBy: userId };
        const res = await tx.schedule.updateMany({ where: { id: row.id, workspaceId, updatedAt: row.updatedAt }, data });
        if (res.count !== 1) throw new DayShareFail(409, "A block of this branch changed while the day was being placed — nothing was changed, try again");
        const after = await tx.schedule.findUnique({ where: { id: row.id }, select: { updatedAt: true } });
        touched.push({ id: row.id, before, afterUpdatedAt: (after?.updatedAt ?? now).toISOString() });
      }

      // 4) the playlists the day plays are shared to this branch, already accepted (one share per playlist that lives in ANOTHER branch)
      const sharesCreated: Ledger["sharesCreated"] = [];
      const sharesExisting: Ledger["sharesExisting"] = [];
      const playlistIds = [...new Set(plan.rows.filter((r) => r.targetType === "PLAYLIST").map((r) => r.targetId))];
      for (const playlistId of playlistIds) {
        const f = facts.playlists[playlistId];
        if (!f || sameBranch(f.branchId, offer.targetBranchId, canonical)) continue;
        const s = await createAcceptedBranchSharesTx(tx, { workspaceId, playlistId, fromUserId: offer.fromUserId, branchIds: [offer.targetBranchId] });
        for (const c of s.created) sharesCreated.push({ id: c.id, playlistId });
        if (s.alreadyOpen.length > 0) sharesExisting.push({ playlistId });
      }

      const result: AcceptResult = {
        created: plan.rows.map((r, n) => ({ id: ids[n]!, time: r.startTimeLocal, end: r.endTimeLocal, name: r.name, target: { type: r.targetType, id: r.targetId, name: fresh.blocks.find((b) => b.target.id === r.targetId && b.time === r.startTimeLocal)?.target.name ?? "" }, days: r.daysOfWeek, date: r.oneOffDateLocal })),
        replaced: plan.conflicts.filter((c) => c.kind === "replaced"),
        ties: plan.conflicts.filter((c) => c.kind === "tie"),
        skipped: plan.skipped,
        warnings: plan.warnings,
        applied: plan.applied,
        sharesCreated: sharesCreated.length,
      };
      const ledger: Ledger = { batchId, created: ids.map((id) => ({ id, updatedAt: stamp.get(id) ?? now.toISOString() })), touched, sharesCreated, sharesExisting, result };
      await tx.scheduleDayShare.update({ where: { id: offer.id }, data: { ledger: ledger as unknown as Prisma.InputJsonValue } });
      await writeTenantAuditLog(tx, {
        action: "schedule_day_share.answer", entity: "schedule_day_share", actorUserId: userId, workspaceId, targetUserId: offer.id, ipAddress: i.ip ?? null,
        metadata: { action: "accept", batchId, targetBranchId: offer.targetBranchId, mode: plan.applied.mode, created: ids.length, replaced: touched.length, skipped: plan.skipped.length },
      });
      return result;
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
  return { ok: true, status: "ACCEPTED", result: tx };
}

async function undoOffer(i: AnswerInput, offer: OfferRowPlain, now: Date): Promise<AnswerResult> {
  const { workspaceId, userId } = i;
  const ledger = (offer.ledger ?? null) as Ledger | null;
  if (!ledger || !Array.isArray(ledger.created)) return fail(409, "There is nothing to undo");
  const result = await prisma.$transaction(
    async (tx) => {
      const cas = await tx.scheduleDayShare.updateMany({ where: { id: offer.id, workspaceId, status: "ACCEPTED" }, data: { status: "UNDONE", undoneAt: now } });
      if (cas.count !== 1) throw new DayShareFail(409, "There is nothing to undo");
      const out: UndoResult = { removed: 0, leftInPlace: [], restored: 0, notRestored: [], sharesRevoked: 0, sharesKept: 0 };

      // created blocks: removed only when nobody edited them since (compare-and-set on updatedAt) — an edited one stays, and is listed
      for (const c of ledger.created) {
        const res = await tx.schedule.deleteMany({ where: { id: c.id, workspaceId, branchId: offer.targetBranchId, updatedAt: new Date(c.updatedAt) } });
        if (res.count === 1) out.removed++;
        else if (await tx.schedule.findFirst({ where: { id: c.id, workspaceId }, select: { id: true } })) out.leftInPlace.push({ id: c.id, reason: "edited-since" });
      }
      // the branch's own blocks that were changed: put back from the before-image — unless they were edited again since
      for (const t of ledger.touched) {
        const res = await tx.schedule.updateMany({
          where: { id: t.id, workspaceId, updatedAt: new Date(t.afterUpdatedAt) },
          data: {
            enabled: t.before.enabled,
            daysOfWeek: t.before.daysOfWeek,
            taxonomyTags: t.before.taxonomyTags === null ? Prisma.DbNull : (t.before.taxonomyTags as Prisma.InputJsonValue),
            updatedBy: t.before.updatedBy,
          },
        });
        if (res.count === 1) out.restored++;
        else out.notRestored.push({ id: t.id, reason: (await tx.schedule.findFirst({ where: { id: t.id, workspaceId }, select: { id: true } })) ? "edited-since" : "gone" });
      }
      // the shares THIS batch made are taken back — except a playlist that is still played here (a block left in place, or another accepted day of this branch)
      const stillUsed = new Set<string>();
      if (out.leftInPlace.length > 0) {
        const rows = await tx.schedule.findMany({ where: { id: { in: out.leftInPlace.map((x) => x.id) }, workspaceId }, select: { targetId: true } });
        for (const r of rows) stillUsed.add(r.targetId);
      }
      const others = await tx.scheduleDayShare.findMany({ where: { workspaceId, targetBranchId: offer.targetBranchId, status: "ACCEPTED", id: { not: offer.id } }, select: { snapshot: true } });
      for (const o of others) for (const b of parseSnapshot(o.snapshot)?.blocks ?? []) if (b.target.type === "PLAYLIST") stillUsed.add(b.target.id);
      const revokeIds = ledger.sharesCreated.filter((s) => !stillUsed.has(s.playlistId)).map((s) => s.id);
      out.sharesRevoked = (await revokeSharesByIdsTx(tx, { workspaceId, shareIds: revokeIds })).length;
      out.sharesKept = ledger.sharesCreated.length - revokeIds.length;

      await tx.scheduleDayShare.update({ where: { id: offer.id }, data: { ledger: { ...ledger, undo: out } as unknown as Prisma.InputJsonValue } });
      await writeTenantAuditLog(tx, {
        action: "schedule_day_share.undo", entity: "schedule_day_share", actorUserId: userId, workspaceId, targetUserId: offer.id, ipAddress: i.ip ?? null,
        metadata: { batchId: ledger.batchId, removed: out.removed, leftInPlace: out.leftInPlace.length, restored: out.restored, notRestored: out.notRestored.length, sharesRevoked: out.sharesRevoked },
      });
      return out;
    },
    { timeout: 20_000, maxWait: 5_000 },
  );
  return { ok: true, status: "UNDONE", undo: result };
}
