// SyncBiz logical identity — minting + external-source resolution (ingest-side; server-only).
//
// PRINCIPLE: a `logicalId` is a STABLE, SyncBiz-OWNED product id. It is minted once and stored; it is
// NEVER computed from a Drive fileId, contentHash, filename, folder, or genre. The Drive fileId is
// provenance metadata that POINTS at a logicalId via the LogicalAssetSource table — it never defines one.
import crypto from "node:crypto";

/** Mint a fresh opaque SyncBiz logicalId. Keeps the existing `a_<16 hex>` FORMAT (so URLs / validation
 *  / the 176 legacy ids stay uniform) but sources it from randomness — NOT sha1(driveFileId). */
export function mintLogicalId() {
  return "a_" + crypto.randomBytes(8).toString("hex");
}

/** Mint a logicalId guaranteed not to collide with an existing mapping or MediaAsset. */
export async function mintUniqueLogicalId(db) {
  for (let i = 0; i < 6; i++) {
    const id = mintLogicalId();
    const inMap = await db.logicalAssetSource.findFirst({ where: { logicalId: id }, select: { id: true } });
    const inAsset = inMap ? null : await db.mediaAsset.findFirst({ where: { logicalId: id }, select: { id: true } });
    if (!inMap && !inAsset) return id;
  }
  throw new Error("mintUniqueLogicalId: exhausted attempts");
}

/** Resolve which logicalId an external source file belongs to. Returns the logicalId, or null if this
 *  (source, externalId) has never been mapped. Never infers — a null means "unknown file". */
export async function resolveLogicalId(db, source, externalId) {
  const row = await db.logicalAssetSource.findUnique({
    where: { source_externalId: { source, externalId } },
    select: { logicalId: true },
  });
  return row ? row.logicalId : null;
}

/**
 * Ensure a (source, externalId) → logicalId mapping exists. If makeCurrent, first demote any other
 * current source of this logicalId (so exactly one isCurrent per logicalId, matching the partial-unique
 * index), then set this one current. Idempotent. Throws on a conflicting remap (a file id already bound
 * to a DIFFERENT logicalId) — that is the false-match guard, never silently rebind.
 */
export async function linkSource(db, logicalId, source, externalId, { makeCurrent = true } = {}) {
  return db.$transaction(async (tx) => {
    const existing = await tx.logicalAssetSource.findUnique({ where: { source_externalId: { source, externalId } } });
    if (existing && existing.logicalId !== logicalId) {
      throw new Error(`linkSource conflict: ${source}:${externalId} is already mapped to ${existing.logicalId}, refusing to rebind to ${logicalId}`);
    }
    if (makeCurrent) {
      await tx.logicalAssetSource.updateMany({
        where: { logicalId, isCurrent: true, NOT: { source, externalId } },
        data: { isCurrent: false },
      });
    }
    if (existing) {
      return tx.logicalAssetSource.update({ where: { id: existing.id }, data: { isCurrent: makeCurrent } });
    }
    return tx.logicalAssetSource.create({ data: { logicalId, source, externalId, isCurrent: makeCurrent } });
  });
}

/**
 * Resolve the logicalId to ingest a source file under:
 *   1. an existing mapping for (source, externalId) → that logicalId (scenarios A, D — same file);
 *   2. an explicit `opts.logicalId` → link the new fileId to that EXISTING logicalId (scenario B, remap);
 *   3. otherwise mint a NEW logicalId (scenario C, truly new) and map it.
 * Never auto-matches by content/name/folder. A re-upload with a new fileId defaults to a NEW product
 * unless the operator explicitly passes the existing logicalId.
 */
export async function resolveOrCreateLogicalId(db, { source, externalId, logicalId: explicit }) {
  const existing = await resolveLogicalId(db, source, externalId);
  if (existing) {
    if (explicit && explicit !== existing) {
      throw new Error(`resolveOrCreateLogicalId conflict: ${source}:${externalId} maps to ${existing}, explicit ${explicit}`);
    }
    return { logicalId: existing, minted: false, mode: "existing-source" };
  }
  if (explicit) {
    await linkSource(db, explicit, source, externalId, { makeCurrent: true });
    return { logicalId: explicit, minted: false, mode: "explicit-remap" };
  }
  const fresh = await mintUniqueLogicalId(db);
  await linkSource(db, fresh, source, externalId, { makeCurrent: true });
  return { logicalId: fresh, minted: true, mode: "new-track" };
}
