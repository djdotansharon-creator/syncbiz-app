/**
 * "What is the station playing now" — reads the ICY StreamTitle that most Icecast / SHOUTcast radio streams embed
 * in the audio (request header `Icy-MetaData: 1` → the server inserts a metadata block every `icy-metaint` bytes).
 * We read only up to the FIRST metadata block and abort, so one lookup costs a few KB of audio.
 *
 * SERVER ONLY. Station URLs are user-provided, so every hop is checked against private / internal addresses
 * (no SSRF into the Railway private network, localhost, link-local / cloud metadata, RFC1918).
 */
import { lookup } from "node:dns/promises";
import net from "node:net";

const MAX_REDIRECTS = 3;
const MAX_METAINT = 256 * 1024;

function isPrivateIpv4(ip: string): boolean {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) return isPrivateIpv4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  // the URL parser rewrites ::ffff:10.0.0.1 as ::ffff:a00:1
  const mappedHex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = parseInt(mappedHex[1], 16);
    const lo = parseInt(mappedHex[2], 16);
    return isPrivateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  return v6 === "::" || v6 === "::1" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

/** True only for an http(s) URL whose host resolves exclusively to public addresses. */
export async function isPublicHttpUrl(raw: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".internal") || host.endsWith(".local")) return false;
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/** Fetch with manual redirects so every hop passes the public-address check. */
async function fetchPublic(url: string, signal: AbortSignal): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!(await isPublicHttpUrl(current))) return null;
    const res = await fetch(current, {
      headers: { "Icy-MetaData": "1", "User-Agent": "VONO/1.0" },
      redirect: "manual",
      signal,
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      await res.body?.cancel().catch(() => {});
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  return null;
}

function decodeMeta(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Israeli stations that are not UTF-8 are usually windows-1255; anything else falls back to latin1.
    const hebrew = bytes.some((b) => b >= 0xe0 && b <= 0xfa);
    return new TextDecoder(hebrew ? "windows-1255" : "latin1").decode(bytes);
  }
}

/** "Artist - Title" as the station sends it, or null (no ICY metadata, HLS, unreachable, empty title). */
export async function readIcyStreamTitle(url: string, timeoutMs = 6000): Promise<string | null> {
  if (/\.m3u8(\?|$)/i.test(url)) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchPublic(url, ctrl.signal);
    return res ? await readFirstIcyTitle(res) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Reads the stream up to its first ICY metadata block and returns the StreamTitle (exported for tests). */
export async function readFirstIcyTitle(res: Response): Promise<string | null> {
  const metaint = Number(res.headers.get("icy-metaint"));
  if (!res.ok || !res.body || !Number.isInteger(metaint) || metaint <= 0 || metaint > MAX_METAINT) {
    await res.body?.cancel().catch(() => {});
    return null;
  }
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let need = metaint + 1;
  let metaLen = -1;
  while (total < need) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
    if (metaLen < 0 && total >= metaint + 1) {
      metaLen = concat(chunks, total)[metaint] * 16;
      need = metaint + 1 + metaLen;
    }
  }
  await reader.cancel().catch(() => {});
  if (metaLen <= 0 || total < need) return null;
  const meta = decodeMeta(concat(chunks, total).subarray(metaint + 1, need)).replace(/\0+$/, "");
  const title = meta.match(/StreamTitle='([\s\S]*?)';/)?.[1]?.trim();
  return title ? title : null;
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
