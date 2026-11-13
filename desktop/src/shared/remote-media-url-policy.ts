/**
 * C1 SECURITY (2026-11-13) — Remote media URL policy for the station player.  PURE (no fs / net / MPV / WS).
 *
 * THREAT: a compromised cloud / WS control-plane sends PLAY / PLAY_SOURCE with an attacker-chosen `url`. Today that
 * url reaches MPV `loadfile` (desktop/src/main/mpv-manager.ts) with no validation, so a remote command could point
 * the station's player at the BRAND's internal network, a loopback service, a UNC / SMB share, or a local file
 * (SSRF / local-file disclosure). This module is the STATIC (pre-connection) gate, applied at two points:
 *   A1 — the WS command boundary (device-ws-manager PLAY / PLAY_SOURCE).
 *   A2 — the engine choke point (mpv-manager loadInternal), the last point before `loadfile`.
 *
 * ALLOWS (every legitimate source keeps working): http(s) to any PUBLIC host — HTTP Radio, YouTube / SoundCloud
 * page URLs (MPV resolves them through yt-dlp), Droploud-resolved R2 / SoundCloud media, and the VONO app origin's
 * /api/media and /api/jingles. Offline encrypted playback is NOT affected: it is rewritten to an internal loopback
 * vault URL INSIDE mpv-manager AFTER this check runs on the original public media URL (so loopback is never the
 * INPUT here — only the trusted downstream output, which is not re-checked).
 *
 * REJECTS: internal / private / loopback / link-local / CGNAT / ULA hosts in ANY encoding (decimal / octal / hex
 * IPv4, IPv4-mapped IPv6, bracketed IPv6) — the WHATWG URL parser canonicalises IPv4 encodings for http(s) so the
 * numeric check sees dotted-decimal; localhost / *.local; file: / local: / UNC / Windows paths / backslashes;
 * bare relative paths; protocol-relative //host; every non-http(s) scheme (ytdl: / data: / javascript: / blob: …);
 * and credentials embedded in the URL (user:pass@ — also keeps secrets out of logs).
 *
 * CANNOT be closed by a static check (documented residual risk — see the B1 Windows-Firewall layer):
 *   - HTTP 3xx redirect to an internal address.
 *   - DNS rebinding (host resolves public at check time, internal at connect time).
 * Both are connection-time behaviours; only a per-app socket rule (mpv.exe + yt-dlp) or network isolation closes them.
 */

const MAX_URL_LEN = 2048;

/**
 * Returns a safe, loadable target string when `raw` is an approved REMOTE media URL, else null.
 * The returned string is the original (trimmed) input for an absolute URL — byte-for-byte, so MPV / yt-dlp
 * behaviour is unchanged for every legitimate source; only a server-relative "/path" (A1, with `appBaseUrl`) is
 * returned resolved to its absolute form.
 *
 * @param appBaseUrl the configured VONO app origin. Pass it at A1 to allow a server-relative "/api/..." path;
 *                   omit it at A2 (the engine only ever sees absolute URLs by then).
 */
export function resolveRemoteMediaTarget(raw: unknown, appBaseUrl?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LEN) return null;
  // Windows drive / UNC / any backslash, and file: / local: — never parsed as a URL, always rejected.
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\") || s.includes("\\")) return null;
  if (/^(file|local):/i.test(s)) return null;

  // Server-relative path ("/api/media/...") → must resolve onto the configured app origin (A1 only).
  if (s.startsWith("/")) {
    if (s.startsWith("//")) return null; // protocol-relative //host
    const base = parseHttpOrigin(appBaseUrl);
    if (!base) return null;
    let abs: URL;
    try {
      abs = new URL(s, base.origin);
    } catch {
      return null;
    }
    if (abs.origin !== base.origin) return null;
    return isForbiddenUrl(abs) ? null : abs.toString();
  }

  // Absolute URL.
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null; // bare relative ("foo.mp3", "C:foo") and anything unparseable
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null; // ytdl: / data: / javascript: / blob: / ...
  if (u.username || u.password) return null; // credentials in URL
  if (isForbiddenUrl(u)) return null;
  return s; // original, unchanged
}

/** Convenience boolean form — true when `u` is an approved absolute remote media URL. */
export function isAllowedRemoteMediaUrl(u: string): boolean {
  return resolveRemoteMediaTarget(u) !== null;
}

function parseHttpOrigin(appBaseUrl?: string | null): URL | null {
  try {
    const b = new URL((appBaseUrl ?? "").trim());
    return b.protocol === "http:" || b.protocol === "https:" ? b : null;
  } catch {
    return null;
  }
}

/** True when the URL's host is an internal / private / loopback / link-local destination (any literal encoding). */
function isForbiddenUrl(u: URL): boolean {
  let host = u.hostname.toLowerCase();
  if (!host) return true;
  host = host.replace(/^\[/, "").replace(/\]$/, ""); // strip IPv6 brackets if the parser kept them
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) return isForbiddenIpv6(host); // IPv6 literal
  if (/^\d+(\.\d+){3}$/.test(host)) return isForbiddenIpv4(host); // IPv4 literal (parser already canonicalised)
  if (/^\d+$/.test(host)) return true; // any bare-numeric host that slipped canonicalisation → reject
  return false; // a DNS name: allowed (redirect / rebinding is Layer B1's job, not a static check's)
}

function isForbiddenIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true; // malformed → reject
  const [a, b, c, d] = parts;
  if (a === 0) return true; // 0.0.0.0/8  "this host"
  if (a === 10) return true; // 10.0.0.0/8  private
  if (a === 127) return true; // 127.0.0.0/8  loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16  link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12  private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16  private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10  CGNAT
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // 255.255.255.255  broadcast
  return false; // public
}

function isForbiddenIpv6(host: string): boolean {
  if (host === "::1") return true; // loopback
  if (host === "::") return true; // unspecified
  // IPv4-mapped (::ffff:a.b.c.d). The WHATWG parser re-serialises the embedded IPv4 to hex (::ffff:a00:1), so the
  // whole mapped range is rejected by prefix — these are never legitimate media hosts (and can mask an internal IP).
  if (host.startsWith("::ffff:")) return true;
  // IPv4-compatible / embedded in dotted form, if a serialiser kept it → apply the IPv4 rule to the embedded address.
  const v4 = host.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4 && host.startsWith("::")) return isForbiddenIpv4(v4[1]);
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10  link-local
  if (/^f[cd]/.test(host)) return true; // fc00::/7  unique-local
  return false; // public IPv6
}
