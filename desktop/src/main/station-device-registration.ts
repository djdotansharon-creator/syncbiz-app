/**
 * Phase 0.2A — Desktop MAIN cloud registration for the durable station identity.
 *
 * MAIN-only, HTTP-only. Registers the Phase 0.1 ProgramData-authoritative durable deviceId (from
 * getEffectiveRuntimeConfig().deviceId) with the cloud endpoint POST /api/devices/register, bound to the
 * caller's Workspace (derived server-side from the desktop_access token) + the config branch.
 *
 * REGISTRATION ONLY. It NEVER touches the WS socket, MASTER election, Protection/watchdog, or the renderer
 * identity, and it NEVER mutates runtime config (deviceId/branchId/workspace/wsToken) on any response — it only
 * READS config via the injected provider (getEffectiveRuntimeConfig's own Phase 0.1 self-heal is expected).
 *
 * The pure helpers + the StationDeviceRegistrar (all deps injected) run without Electron for unit testing.
 */
import { createHash } from "node:crypto";

/** Reuse the existing api-base normalization (strip trailing slashes). */
export function normalizeApiBase(url: string): string {
  return (url ?? "").trim().replace(/\/+$/, "");
}

/** The minimal config view the registrar needs (a subset of DesktopRuntimeConfig). */
export type RegistrationConfigView = {
  deviceId: string;
  branchId: string;
  wsToken: string;
  apiBaseUrl: string;
  desktopTokenExpiresAtIso?: string | null;
};

export type RegistrationRequest = {
  url: string;
  headers: Record<string, string>;
  body: { durableDeviceId: string; branchId: string; platform: string; appVersion: string };
};
export type RegistrationSkip = { skip: "no_token" | "expired" | "no_base" | "no_device_id" };

export type RegistrationOutcome =
  | "created"
  | "refreshed"
  | "unauthorized"
  | "branch_forbidden"
  | "conflict"
  | "server_error"
  | "other";

export const RETRY_MAX = 4;
const BACKOFF_MS = [5_000, 10_000, 20_000, 40_000];

export function computeBackoffMs(attempt: number): number {
  return BACKOFF_MS[Math.min(Math.max(attempt, 1), BACKOFF_MS.length) - 1];
}

/** true only when expiry metadata EXISTS and is definitely in the past. Missing/invalid expiry → false (attempt). */
export function isTokenDefinitelyExpired(expiryIso: string | null | undefined, nowMs: number): boolean {
  if (!expiryIso || typeof expiryIso !== "string" || !expiryIso.trim()) return false;
  const t = Date.parse(expiryIso);
  if (!Number.isFinite(t)) return false; // can't determine → let the server validate
  return t <= nowMs;
}

/** Build the HTTP request, or a skip reason. workspaceId is NEVER included (server derives it from the token). */
export function buildRegistrationRequest(
  cfg: RegistrationConfigView,
  appVersion: string,
  platform: string,
  nowMs: number,
): RegistrationRequest | RegistrationSkip {
  const token = (cfg.wsToken ?? "").trim();
  if (!token) return { skip: "no_token" };
  if (isTokenDefinitelyExpired(cfg.desktopTokenExpiresAtIso, nowMs)) return { skip: "expired" };
  const base = normalizeApiBase(cfg.apiBaseUrl);
  if (!base) return { skip: "no_base" };
  const durableDeviceId = (cfg.deviceId ?? "").trim();
  if (!durableDeviceId) return { skip: "no_device_id" };
  const branchId = (cfg.branchId ?? "").trim() || "default";
  return {
    url: `${base}/api/devices/register`,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: { durableDeviceId, branchId, platform, appVersion },
  };
}

export function classifyRegistrationStatus(status: number): RegistrationOutcome {
  if (status === 201) return "created";
  if (status === 200) return "refreshed";
  if (status === 401) return "unauthorized";
  if (status === 403) return "branch_forbidden";
  if (status === 409) return "conflict";
  if (status >= 500) return "server_error";
  return "other";
}

export function isRetryableOutcome(o: RegistrationOutcome | "network_error"): boolean {
  return o === "network_error" || o === "server_error";
}

/** Registration-relevant fields: a change in any of these should re-trigger registration. */
export type RegistrationRelevant = { branchId: string; apiBaseUrl: string; wsToken: string };
export function pickRegistrationRelevant(cfg: RegistrationConfigView): RegistrationRelevant {
  return { branchId: cfg.branchId, apiBaseUrl: normalizeApiBase(cfg.apiBaseUrl), wsToken: cfg.wsToken };
}
export function registrationRelevantChanged(a: RegistrationRelevant | null, b: RegistrationRelevant): boolean {
  if (!a) return true;
  return a.branchId !== b.branchId || a.apiBaseUrl !== b.apiBaseUrl || a.wsToken !== b.wsToken;
}

/** Dedupe signature. Includes a HASH of the token (never the raw token) — the signature must never be logged. */
export function registrationSignature(cfg: RegistrationConfigView, appVersion: string): string {
  const tokenId = createHash("sha256").update(cfg.wsToken ?? "").digest("hex").slice(0, 16);
  return [cfg.deviceId, cfg.branchId, normalizeApiBase(cfg.apiBaseUrl), appVersion, tokenId].join("\u0000");
}

/**
 * Safe, non-reversible fingerprint for logs. NEVER logs the raw durable id — Phase 0.1 accepts legacy ids as
 * short as 8 chars, so a prefix could equal the whole secret; a sha256 slice never can (GAP 2 relies partly on
 * durable-id secrecy). Stable for diagnostics (same id → same fingerprint).
 */
export function deviceIdFingerprint(id: string): string {
  return createHash("sha256").update(id ?? "").digest("hex").slice(0, 8);
}

export type RegistrarDeps = {
  /** Read the CURRENT effective config (Phase 0.1 reconciled). Called fresh on every trigger. */
  getConfig: () => RegistrationConfigView;
  appVersion: string;
  platform: string;
  fetchImpl: typeof fetch;
  now: () => number;
  /** Schedule a (possibly async) callback; the real impl must .unref() the timer. */
  setTimer: (fn: () => void | Promise<void>, ms: number) => void;
  /** Structured logger; must never receive the token or full auth header. */
  log: (event: string, fields: Record<string, unknown>) => void;
};

/**
 * Fire-and-forget station registration with in-memory dedupe + bounded backoff. Single in-flight; a successful
 * registration signature suppresses duplicate POSTs (so repeated WS reconnects / focus create ZERO extra POSTs).
 */
export class StationDeviceRegistrar {
  private inFlight = false;
  private attempt = 0;
  private lastSuccessSignature: string | null = null;
  private pendingReason: string | null = null; // a trigger that arrived while a sequence was in-flight/backing off

  constructor(private readonly deps: RegistrarDeps) {}

  /** Fire-and-forget entry point for call sites (startup / sign-in / config-change). Never blocks the caller. */
  trigger(reason: string): void {
    void this.runOnce(reason);
  }

  /** Awaitable core (for tests). Performs the first attempt; retries schedule themselves via setTimer. */
  async runOnce(reason: string): Promise<void> {
    if (this.inFlight) {
      // Do NOT start a concurrent POST and do NOT lose the trigger: record it and re-run with FRESH config once
      // the current sequence reaches any terminal finish (so a new token / branch / apiBaseUrl still registers).
      this.pendingReason = reason;
      this.deps.log("station_registration_attempt", { reason, skipped: "in_flight", pending: true });
      return;
    }
    let cfg: RegistrationConfigView;
    try {
      cfg = this.deps.getConfig();
    } catch {
      return; // config unavailable → do nothing (never throw into startup/playback)
    }
    const built = buildRegistrationRequest(cfg, this.deps.appVersion, this.deps.platform, this.deps.now());
    if ("skip" in built) {
      if (built.skip === "expired") this.deps.log("station_registration_unauthorized", { reason, skipped: "token_expired" });
      else this.deps.log("station_registration_attempt", { reason, skipped: built.skip });
      return;
    }
    const sig = registrationSignature(cfg, this.deps.appVersion);
    if (sig === this.lastSuccessSignature) return; // already registered this signature → ZERO POST

    this.inFlight = true;
    this.attempt = 0;
    await this.attemptOnce(reason, built, sig);
  }

  /** Terminal end of a sequence (success or non-retryable/exhausted). Clears in-flight and, if a trigger arrived
   *  meanwhile, re-runs with FRESH config (never the stale built request); normal signature dedupe still applies. */
  private finalize(): void {
    this.inFlight = false;
    this.attempt = 0;
    if (this.pendingReason !== null) {
      const reason = this.pendingReason;
      this.pendingReason = null;
      this.deps.setTimer(() => this.runOnce(reason), 0); // sequential, not concurrent; unref'd by the real setTimer
    }
  }
  private onSuccess(sig: string): void {
    this.lastSuccessSignature = sig;
    this.finalize();
  }

  private async attemptOnce(reason: string, built: RegistrationRequest, sig: string): Promise<void> {
    this.attempt += 1;
    const attempt = this.attempt;
    const safe = {
      reason,
      attempt,
      branchId: built.body.branchId,
      appVersion: built.body.appVersion,
      platform: built.body.platform,
      deviceIdFingerprint: deviceIdFingerprint(built.body.durableDeviceId),
    };
    this.deps.log("station_registration_attempt", safe);

    let status: number;
    let serverError: string | undefined;
    try {
      const res = await this.deps.fetchImpl(built.url, {
        method: "POST",
        headers: built.headers,
        body: JSON.stringify(built.body),
      });
      status = res.status;
      if (status === 409) {
        try {
          const j = (await res.json()) as { error?: unknown };
          if (typeof j?.error === "string") serverError = j.error;
        } catch {
          /* body optional */
        }
      }
    } catch (e) {
      this.deps.log("station_registration_network_error", { ...safe, err: e instanceof Error ? e.message : String(e) });
      this.scheduleRetry(reason, built, sig);
      return;
    }

    const outcome = classifyRegistrationStatus(status);
    const withStatus = { ...safe, httpStatus: status };
    switch (outcome) {
      case "created":
        this.onSuccess(sig);
        this.deps.log("station_registration_created", withStatus);
        return;
      case "refreshed":
        this.onSuccess(sig);
        this.deps.log("station_registration_refreshed", withStatus);
        return;
      case "unauthorized": // 401 — terminal, no retry, no mutation
        this.finalize();
        this.deps.log("station_registration_unauthorized", withStatus);
        return;
      case "branch_forbidden": // 403 — terminal, no retry, no mutation
        this.finalize();
        this.deps.log("station_registration_branch_forbidden", withStatus);
        return;
      case "conflict": // 409 — terminal, NEVER auto-rebind / reset id / change branch
        this.finalize();
        this.deps.log("station_registration_conflict", { ...withStatus, serverError });
        return;
      case "server_error": // 5xx — bounded retry
        this.deps.log("station_registration_server_error", withStatus);
        this.scheduleRetry(reason, built, sig);
        return;
      default: // unexpected status — treat as terminal (no aggressive retry)
        this.finalize();
        this.deps.log("station_registration_server_error", { ...withStatus, note: "unexpected_status" });
        return;
    }
  }

  private scheduleRetry(reason: string, built: RegistrationRequest, sig: string): void {
    if (this.attempt >= RETRY_MAX) {
      this.deps.log("station_registration_retry_exhausted", { reason, attempts: this.attempt });
      this.finalize();
      return;
    }
    const delay = computeBackoffMs(this.attempt); // backoff after the just-failed attempt
    // stays inFlight during backoff → preserves single-in-flight
    this.deps.setTimer(() => this.attemptOnce(reason, built, sig), delay);
  }
}
