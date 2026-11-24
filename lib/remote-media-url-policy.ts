/**
 * F1 SECURITY (2026-11-18) — Remote media / fetch URL policy for the NEXT APP (lib).
 *
 * PURE module (no net / fs). This is the THIRD mirror of the same host-classification logic:
 *   - `server/remote-media-url-policy.ts`            (WebSocket server, C2)
 *   - `desktop/src/shared/remote-media-url-policy.ts` (station, C1 A1/A2)
 *   - `lib/remote-media-url-policy.ts`               (this file — Next REST routes)
 *
 * WHY THREE COPIES (documented limitation): the Next app (`@/*` = repo root), the WS server
 * (`server/tsconfig.json`: rootDir ".", include ["*.ts"], standalone NodeNext ESM build) and the
 * Electron desktop each compile as SEPARATE builds. A single shared module cannot be imported across
 * them without breaking the server/desktop build isolation (server's rootDir/include excludes `lib/`).
 * The copies are kept provably identical by a 3-way parity test
 * (`server/verify-remote-media-url-policy-parity.ts`) that asserts the same verdicts for all three.
 * If the build layout is ever unified, collapse these into one module.
 *
 * The exported IP predicates (`isForbiddenIpv4`, `isForbiddenIpv6`, `isForbiddenResolvedIp`) are reused by
 * `lib/ssrf-safe-fetch.ts` for CONNECTION-TIME enforcement (the resolved IP is validated inside the socket
 * `lookup`), so the private-range rules live in ONE place and are not duplicated inside the fetch layer.
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
  if (s.startsWith("/")) return !/^\/api\//i.test(s);
  return resolveRemoteMediaTarget(s) === null; // absolute → forbidden unless an approved public http(s) target
}

/** Returns a safe loadable target when `raw` is an approved absolute remote media URL, else null (mirrors server/desktop). */
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

/** True when the URL's host is a forbidden (internal / loopback / literal-private) destination. */
export function isForbiddenUrl(u: URL): boolean {
  let host = u.hostname.toLowerCase();
  if (!host) return true;
  host = host.replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host.includes(":")) return isForbiddenIpv6(host);
  if (/^\d+(\.\d+){3}$/.test(host)) return isForbiddenIpv4(host);
  if (/^\d+$/.test(host)) return true;
  return false;
}

/** True when a dotted-quad IPv4 string is an internal / reserved address. */
export function isForbiddenIpv4(host: string): boolean {
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

/** True when an IPv6 host string is loopback / link-local / ULA / mapped-internal. */
export function isForbiddenIpv6(host: string): boolean {
  if (host === "::1") return true;
  if (host === "::") return true;
  if (host.startsWith("::ffff:")) return true; // IPv4-mapped (parser re-serialises to hex)
  const v4 = host.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4 && host.startsWith("::")) return isForbiddenIpv4(v4[1]);
  if (/^fe[89ab]/.test(host)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(host)) return true; // fc00::/7 ULA
  return false;
}

/**
 * CONNECTION-TIME predicate used by lib/ssrf-safe-fetch.ts: validates an ALREADY-RESOLVED numeric IP
 * (as returned by dns.lookup) against the same private/reserved ranges. `family` is 4 or 6.
 */
export function isForbiddenResolvedIp(address: string, family: number): boolean {
  const addr = (address || "").toLowerCase().replace(/%.*$/, ""); // strip zone id
  if (!addr) return true;
  if (family === 4) return isForbiddenIpv4(addr);
  // family 6 — may be an IPv4-mapped address like ::ffff:127.0.0.1
  const mapped = addr.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && (addr.startsWith("::ffff:") || addr.startsWith("::"))) return isForbiddenIpv4(mapped[1]);
  return isForbiddenIpv6(addr);
}
