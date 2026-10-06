/**
 * Gate 2B-1 — jingle pad branch compatibility (PURE, no DB).
 *
 * During the canonical-branch transition one logical pad (workspace + padId) may be stored under the legacy branch
 * key "default" OR under the workspace's canonical branch id. Reads accept either; writes update the row that
 * already represents the pad (never a second copy); a new pad is written canonical. If BOTH aliases hold a row for
 * the same pad we do not guess which one is right — the pad is reported as a conflict (fail safe).
 */

export type PadRowLike = { id: string; padId: string; branchId: string };

/** Group pad rows (already filtered to the branch's alias set) into one row per padId + the conflicting padIds. */
export function groupPadRows<T extends PadRowLike>(rows: T[]): { pads: T[]; conflicts: string[] } {
  const byPad = new Map<string, T[]>();
  for (const r of rows) {
    const list = byPad.get(r.padId);
    if (list) list.push(r);
    else byPad.set(r.padId, [r]);
  }
  const pads: T[] = [];
  const conflicts: string[] = [];
  for (const [padId, list] of byPad) {
    if (list.length === 1) pads.push(list[0]);
    else conflicts.push(padId);
  }
  pads.sort((a, b) => (a.padId < b.padId ? -1 : a.padId > b.padId ? 1 : 0));
  return { pads, conflicts: conflicts.sort() };
}

export type PadWritePlan =
  | { kind: "update"; id: string }
  | { kind: "create"; branchId: string }
  | { kind: "conflict" };

/**
 * Decide how to persist one pad given the rows that already represent it under ANY alias of the branch.
 * `writeBranchId` is the branch a NEW row gets (canonical when the workspace has one, else the legacy key).
 */
export function planPadWrite(existing: PadRowLike[], writeBranchId: string): PadWritePlan {
  if (existing.length === 0) return { kind: "create", branchId: writeBranchId };
  if (existing.length === 1) return { kind: "update", id: existing[0].id };
  return { kind: "conflict" };
}

// ── Read / write flows over a minimal repository (the route wires Prisma; tests wire an in-memory fake) ──────────
export type PadRow = PadRowLike & {
  workspaceId: string;
  label: string;
  url: string;
  color: string | null;
  bellStyle: string | null;
  preRoll: boolean;
};
export type PadData = Pick<PadRow, "label" | "url" | "color" | "bellStyle" | "preRoll">;
export type PadRepo = {
  findMany(where: { workspaceId: string; branchIds: string[]; padId?: string }): Promise<PadRow[]>;
  update(id: string, data: PadData): Promise<PadRow>;
  create(data: PadData & { workspaceId: string; branchId: string; padId: string }): Promise<PadRow>;
};

/** GET: one row per logical pad from ANY alias of the branch; pads stored under both aliases are reported, not guessed. */
export async function readPads(repo: PadRepo, workspaceId: string, branchIds: string[]): Promise<{ pads: PadRow[]; conflicts: string[] }> {
  return groupPadRows(await repo.findMany({ workspaceId, branchIds }));
}

/** POST: update the row that already represents the pad, else create it under `writeBranchId`; conflict → no write. */
export async function writePad(
  repo: PadRepo,
  args: { workspaceId: string; padId: string; data: PadData; branchIds: string[]; writeBranchId: string },
): Promise<{ ok: true; row: PadRow } | { ok: false; conflict: true }> {
  // Two attempts: a concurrent first-create of the same pad loses the unique race (P2002) → re-plan as an update.
  for (let attempt = 0; ; attempt++) {
    const existing = await repo.findMany({ workspaceId: args.workspaceId, branchIds: args.branchIds, padId: args.padId });
    const plan = planPadWrite(existing, args.writeBranchId);
    if (plan.kind === "conflict") return { ok: false, conflict: true };
    if (plan.kind === "update") return { ok: true, row: await repo.update(plan.id, args.data) };
    try {
      return { ok: true, row: await repo.create({ ...args.data, workspaceId: args.workspaceId, branchId: plan.branchId, padId: args.padId }) };
    } catch (e) {
      if ((e as { code?: string })?.code !== "P2002" || attempt > 0) throw e;
    }
  }
}
