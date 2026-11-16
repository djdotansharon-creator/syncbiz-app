/**
 * C2 SECURITY (2026-11-13) — Remote media URL policy for the WebSocket server. PURE (no net / fs / ws).
 *
 * This MIRRORS the station-side policy in `desktop/src/shared/remote-media-url-policy.ts`. The two files are
 * SEPARATE builds (the server is its own ESM project), so the core logic is duplicated intentionally and kept in
 * sync by a parity test (`server/verify-remote-media-url-policy-parity.ts`) that asserts identical verdicts.
 *
 * The server forwards remote COMMANDs (PLAY / PLAY_SOURCE / QUEUE_NEXT / PLAY_INTERRUPT) to the designated MASTER
 * station. C2 is the server-side gate: it DROPS a command whose immediate media target is forbidden — defense in
 * depth with the station's A1 (device-ws-manager) and A2 (mpv-manager) gates, so a compromised CONTROL/owner/guest
 * cannot even get a forbidden target forwarded.
 *
 * `isForbiddenMediaTarget` is deliberately conservative to NEVER block a legitimate source:
 *  - empty / missing url → NOT forbidden (PLAY/PLAY_INTERRUPT pause-resume; PLAY_SOURCE LOCAL metadata-only).
 *  - a server-relative path UNDER "/api/" (e.g. "/api/jingles/audio/<id>", "/api/media/<id>") → NOT forbidden: it
 *    has no host, so it can only resolve onto the station's trusted app origin (never an internal host) and is
 *    re-validated at A2. This is what keeps JINGLES working. Any other relative path ("/admin", "/etc/…") → forbidden.
 *  - an absolute URL → forbidden unless it is an approved PUBLIC http(s) target (HTTP radio, YouTube/SoundCloud,
 *    Droploud/R2, direct streams). Internal / private / loopback / file / UNC / non-http(s) / credentials → forbidden.
 */

const MAX_URL_LEN = 2048;

/**
 * Server-side predicate: true ONLY for a definitely-forbidden remote media target. Empty url and server-relative
 * "/path" are treated as NOT forbidden (see the module header). Never blocks a legitimate public source.
 */
export function isForbiddenMediaTarget(raw: unknown): boolean {
  if (typeof raw !== "string") return false;
  const s = raw.trim();
  if (!s) return false; // empty = pause/resume / LOCAL metadata-only → not a forbidden target
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\") || s.includes("\\")) return true; // Windows / UNC / backslash
  if (/^(file|local):/i.test(s)) return true;
  if (s.startsWith("//")) return true; // protocol-relative //host
  // server-relative path: allowed ONLY under the app's /api/ surface (where jingles + media live). It carries no
  // host, so it can only resolve to the station's OWN trusted app origin — never an internal host — and A2 re-checks
  // it; restricting to /api/ keeps it to approved media routes rather than an arbitrary path on the app origin.
  if (s.startsWith("/")) return !/^\/api\//i.test(s);
  return resolveRemoteMediaTarget(s) === null; // absolute → forbidden unless an approved public http(s) target
}

/** Returns a safe loadable target when `raw` is an approved absolute remote media URL, else null (mirrors desktop). */
export function resolveRemoteMediaTarget(raw: unknown, appBaseUrl?: string | null): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s || s.length > MAX_URL_LEN) return null;
  if (/^[a-zA-Z]:[\\/]/.test(s) || s.startsWith("\\\\") || s.includes("\\")) return null;
  if (/^(file|local):/i.test(s)) return null;

  if (s.startsWith("/")) {
    if (s.startsWith("//")) return null;
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

  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (isForbiddenUrl(u)) return null;
  return s;
}

function parseHttpOrigin(appBaseUrl?: string | null): URL | null {
  try {
    const b = new URL((appBaseUrl ?? "").trim());
    return b.protocol === "http:" || b.protocol === "https:" ? b : null;
  } catch {
    return null;
  }
}

function isForbiddenUrl(u: URL): boolean {
  let host = u.hostname.toLowerCase();
  if (!host) return true;
  host = host.replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) return isForbiddenIpv6(host);
  if (/^\d+(\.\d+){3}$/.test(host)) return isForbiddenIpv4(host);
  if (/^\d+$/.test(host)) return true;
  return false;
}

function isForbiddenIpv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b, c, d] = parts;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 255 && b === 255 && c === 255 && d === 255) return true; // broadcast
  return false;
}

function isForbiddenIpv6(host: string): boolean {
  if (host === "::1") return true;
  if (host === "::") return true;
  if (host.startsWith("::ffff:")) return true; // IPv4-mapped (parser re-serialises to hex)
  const v4 = host.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4 && host.startsWith("::")) return isForbiddenIpv4(v4[1]);
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10
  if (/^f[cd]/.test(host)) return true; // fc00::/7
  return false;
}
