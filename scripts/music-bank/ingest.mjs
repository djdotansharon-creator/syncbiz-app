// Music Bank ingest primitive: (Drive-sourced) file -> validate(ffprobe) -> sha256 -> R2(content-addressed)
// -> MediaAsset (PENDING->READY). Idempotent, content-dedup, safe replacement (RETIRE, no hard-delete),
// crash-safe (rerun resumes). Separation: Drive=source, R2=bytes, MediaAsset=truth, CatalogItem=product.
import fs from 'node:fs'; import crypto from 'node:crypto'; import { spawnSync } from 'node:child_process';
import { head, put } from './r2-client.mjs';

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

/** Ingest ONE source file. Idempotent + crash-safe. `failAfter` ('pending'|'upload') injects a fault for testing. */
export async function ingestFile(cfg, db, { filePath, sourceId, name, genreId, provider='R2', ffprobe='ffprobe', failAfter=null }){
  const bytes = fs.readFileSync(filePath);
  const val = probe(filePath, ffprobe);
  if (!val.ok) return { result:'rejected', reason:val.reason };
  const ext = (name.split('.').pop()||'mp3').toLowerCase();
  const mime = MIME[ext] || 'audio/mpeg';
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const objectKey = `assets/${hash}.${ext}`;                       // content-addressed → immutable
  const whereObj = { provider_bucket_objectKey: { provider, bucket: cfg.bucket, objectKey } };

  let row = await db.mediaAsset.findUnique({ where: whereObj });
  if (row && row.status === 'READY') return { result:'idempotent-skip', assetId: row.id, objectKey };

  if (!row) {
    row = await db.mediaAsset.create({ data: {
      provider, bucket: cfg.bucket, objectKey, mimeType: mime, sizeBytes: BigInt(bytes.length),
      durationSeconds: val.durationSeconds, contentHash: hash, contentHashAlgorithm:'sha256',
      status:'PENDING', genreId, ingestSource:'google_drive', ingestExternalId: sourceId,
    }});
  }
  if (failAfter === 'pending') throw new Error('INJECTED_FAILURE_after_pending');

  const h1 = await head(cfg, objectKey);                          // dedup: bytes already present?
  if (h1.status !== 200) { const p = await put(cfg, objectKey, bytes, mime); if (!p.ok) throw new Error('R2 upload failed '+p.status); }
  if (failAfter === 'upload') throw new Error('INJECTED_FAILURE_after_upload');

  const h2 = await head(cfg, objectKey);                          // verify integrity (size)
  if (h2.status !== 200 || h2.size !== bytes.length) throw new Error('R2 verify failed');

  // Replacement: same source file, new content -> retire the old asset(s), keep the row (no hard delete).
  await db.mediaAsset.updateMany({
    where: { ingestSource:'google_drive', ingestExternalId: sourceId, objectKey: { not: objectKey }, status:'READY' },
    data: { status:'RETIRED' },
  });
  const ready = await db.mediaAsset.update({ where: { id: row.id }, data: { status:'READY', lastVerifiedAt: new Date() } });
  return { result: row.status==='PENDING'?'ingested':'ingested', assetId: ready.id, objectKey, contentHash: hash, resumed: h1.status===200 };
}
