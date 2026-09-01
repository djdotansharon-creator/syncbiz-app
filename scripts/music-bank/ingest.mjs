// Music Bank ingest primitive: (Drive-sourced) file -> validate(ffprobe) -> sha256 -> R2(content-addressed)
// -> MediaAsset (PENDING->READY). Idempotent, content-dedup, ATOMIC replacement (RETIRE, no hard-delete),
// crash-safe (rerun resumes).
//
// IDENTITY: logicalId is resolved from the LogicalAssetSource mapping (SyncBiz-owned), NEVER derived
// from the Drive fileId. Drive fileId = ingestExternalId (provenance). MediaAsset = physical/versioned.
// contentHash/objectKey = bytes identity. Replacement retires the prior READY of the SAME logicalId.
import fs from 'node:fs'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
import { head, put } from './r2-client.mjs';
import { resolveOrCreateLogicalId } from './logical-identity.mjs';

const MIME = { mp3:'audio/mpeg', m4a:'audio/mp4', aac:'audio/aac', wav:'audio/wav', flac:'audio/flac', ogg:'audio/ogg' };
export function probe(filePath, ffprobe='ffprobe'){
  const r = spawnSync(ffprobe, ['-v','error','-print_format','json','-show_format','-show_streams', filePath], { encoding:'utf8', maxBuffer:1<<24 });
  if (r.status !== 0) return { ok:false, reason:'ffprobe error: '+(r.stderr||'').slice(0,120) };
  let j; try { j = JSON.parse(r.stdout); } catch { return { ok:false, reason:'ffprobe json parse' }; }
  const a = (j.streams||[]).find(s => s.codec_type === 'audio');
  if (!a) return { ok:false, reason:'no audio stream' };
  const dur = parseFloat(j.format?.duration);
  return { ok:true, codec:a.codec_name, durationSeconds: Number.isFinite(dur)?dur:null, formatName:j.format?.format_name };
}

/**
 * Ingest ONE source file. Idempotent + crash-safe.
 * Options:
 *   - sourceId: the external (Drive) file id — provenance + mapping key.
 *   - logicalId: OPTIONAL explicit logicalId. Pass it to remap a NEW fileId onto an EXISTING product
 *     (scenario B). Omit it and an unmapped file becomes a NEW product (scenario C) — never an auto-match.
 *   - source: external source system (default "google_drive").
 *   - r2: OPTIONAL { head, put } override (tests inject a fake; defaults to the real R2 client).
 *   - failAfter: 'pending' | 'upload' | 'txn' — inject a fault for testing atomicity/crash-safety.
 */
export async function ingestFile(cfg, db, { filePath, sourceId, name, genreId, provider='R2', ffprobe='ffprobe', failAfter=null, logicalId=null, source='google_drive', r2=null }){
  const R2 = r2 || { head, put };
  const bytes = fs.readFileSync(filePath);
  const val = probe(filePath, ffprobe);
  if (!val.ok) return { result:'rejected', reason:val.reason };
  const ext = (name.split('.').pop()||'mp3').toLowerCase();
  const mime = MIME[ext] || 'audio/mpeg';
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  // 1. Resolve SyncBiz logical identity FIRST (mapping is source of truth; never derived from fileId).
  const resolved = await resolveOrCreateLogicalId(db, { source, externalId: sourceId, logicalId });
  const lid = resolved.logicalId;

  // Content-addressed key. If those exact bytes are ALREADY owned by a DIFFERENT logicalId (genuinely
  // duplicate source tracks — the same audio published under two catalog entries), disambiguate so THIS
  // logicalId gets its own object + MediaAsset and stays independently playable. Same-logicalId re-runs
  // keep the plain key (true idempotency). Rare; costs one duplicated R2 object.
  let objectKey = `assets/${hash}.${ext}`;                          // content-addressed → immutable
  const keyClash = await db.mediaAsset.findUnique({ where: { provider_bucket_objectKey: { provider, bucket: cfg.bucket, objectKey } } });
  if (keyClash && keyClash.logicalId !== lid) objectKey = `assets/${hash}__${lid}.${ext}`;

  const whereObj = { provider_bucket_objectKey: { provider, bucket: cfg.bucket, objectKey } };
  let row = await db.mediaAsset.findUnique({ where: whereObj });
  if (row && row.status === 'READY') return { result:'idempotent-skip', assetId: row.id, logicalId: lid, objectKey, identity: resolved.mode };

  if (!row) {
    row = await db.mediaAsset.create({ data: {
      logicalId: lid, provider, bucket: cfg.bucket, objectKey, mimeType: mime, sizeBytes: BigInt(bytes.length),
      durationSeconds: val.durationSeconds, contentHash: hash, contentHashAlgorithm:'sha256',
      status:'PENDING', genreId, ingestSource: source, ingestExternalId: sourceId,
    }});
  } else if (row.logicalId !== lid) {
    // A PENDING row already exists for this exact content but under a different logicalId (rare with
    // content-addressing) — align it to the resolved identity before promoting.
    row = await db.mediaAsset.update({ where: { id: row.id }, data: { logicalId: lid } });
  }
  if (failAfter === 'pending') throw new Error('INJECTED_FAILURE_after_pending');

  const h1 = await R2.head(cfg, objectKey);                        // dedup: bytes already present?
  if (h1.status !== 200) { const p = await R2.put(cfg, objectKey, bytes, mime); if (!p.ok) throw new Error('R2 upload failed '+p.status); }
  if (failAfter === 'upload') throw new Error('INJECTED_FAILURE_after_upload');

  const h2 = await R2.head(cfg, objectKey);                        // verify integrity (size)
  if (h2.status !== 200 || h2.size !== bytes.length) throw new Error('R2 verify failed');

  // 2. ATOMIC replacement: retire the prior READY of THIS logicalId, then promote the new one — in one
  //    transaction. Order (retire → promote) keeps the partial-unique (one READY per logicalId) satisfied
  //    at every step. If the transaction throws, it rolls back whole: the old version stays READY and
  //    playable, and the new version stays PENDING (never partially authoritative).
  const ready = await db.$transaction(async (tx) => {
    await tx.mediaAsset.updateMany({ where: { logicalId: lid, status: 'READY', id: { not: row.id } }, data: { status: 'RETIRED' } });
    if (failAfter === 'txn') throw new Error('INJECTED_FAILURE_in_txn');
    return tx.mediaAsset.update({ where: { id: row.id }, data: { status: 'READY', lastVerifiedAt: new Date() } });
  });
  return { result:'ingested', assetId: ready.id, logicalId: lid, objectKey, contentHash: hash, resumed: h1.status===200, identity: resolved.mode };
}
