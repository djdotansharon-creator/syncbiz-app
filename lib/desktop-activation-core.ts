/**
 * PURE orchestration core for desktop one-login activation (no React, no fetch, no Electron) so the
 * retry / fail-closed behaviour is unit-testable with injected deps.
 *
 * Reliability contract (PR #51 follow-up):
 *  - Activation is a SUCCESS only when the server confirms the StationDevice is BOUND, returns a token,
 *    AND `applyDesktopAuth` returns { ok:true }. Only then may the caller mark activation complete.
 *  - A binding CONFLICT (server 409 / token not bound) is TERMINAL and fail-closed: never treated as
 *    success, no token applied, and we stop retrying (retrying cannot resolve a workspace/branch conflict).
 *  - Every other failure (not-signed-in-yet, no deviceId, network error, 5xx, missing token,
 *    applyDesktopAuth { ok:false }) is TRANSIENT → retry with a small, capped (bounded) backoff.
 *  - Running in a plain browser (no bridge) is a no-op.
 */

export type TokenResult =
  | { status: "ok"; token: string; expiresAtIso?: string } // 200 + bound + token present
  | { status: "conflict" } // 409 — device cannot bind to this workspace/branch (terminal)
  | { status: "transient" }; // network / 5xx / unexpected / missing token

export type ActivationDeps = {
  /** Is the hosted session authenticated? (/api/auth/me ok) */
  checkSession: () => Promise<boolean>;
  /** Durable MAIN deviceId from the bridge, or null if not yet available. */
  getDeviceId: () => Promise<string | null>;
  /** Branch id from the bridge (defaults to "default"). */
  getBranchId: () => Promise<string>;
  /** POST /api/auth/desktop/token-from-session, normalised to a TokenResult. */
  requestToken: (input: { deviceId: string; branchId: string }) => Promise<TokenResult>;
  /** Hand the bound token to MAIN; returns applyDesktopAuth's ok flag. */
  applyAuth: (input: { token: string; expiresAtIso?: string }) => Promise<boolean>;
};

export type AttemptResult =
  | { kind: "success" }
  | { kind: "conflict"; reason: string } // terminal, fail-closed
  | { kind: "retry"; reason: string }; // transient — try again later

const retry = (reason: string): AttemptResult => ({ kind: "retry", reason });

/**
 * ONE activation attempt. Never throws — every error maps to a `retry` outcome except a true binding
 * conflict, which maps to the terminal `conflict` outcome. An unbound token is NEVER applied.
 */
export async function attemptActivationOnce(deps: ActivationDeps): Promise<AttemptResult> {
  let signedIn = false;
  try {
    signedIn = await deps.checkSession();
  } catch {
    return retry("session-check-failed");
  }
  if (!signedIn) return retry("not-signed-in");

  let deviceId: string | null = null;
  try {
    deviceId = await deps.getDeviceId();
  } catch {
    return retry("device-id-failed");
  }
  if (!deviceId) return retry("no-device-id");

  let branchId = "default";
  try {
    branchId = (await deps.getBranchId()) || "default";
  } catch {
    branchId = "default";
  }

  let token: TokenResult;
  try {
    token = await deps.requestToken({ deviceId, branchId });
  } catch {
    return retry("token-request-failed");
  }
  if (token.status === "conflict") return { kind: "conflict", reason: "binding-conflict" };
  if (token.status !== "ok" || !token.token) return retry("no-bound-token");

  let ok = false;
  try {
    ok = await deps.applyAuth({ token: token.token, expiresAtIso: token.expiresAtIso });
  } catch {
    return retry("apply-failed");
  }
  if (!ok) return retry("apply-not-ok");
  return { kind: "success" };
}

/** Small, bounded exponential backoff: base * 2^(attempt-1), capped. attempt is 1-based. */
export function backoffDelayMs(attempt: number, baseMs: number, capMs: number): number {
  const d = baseMs * Math.pow(2, Math.max(0, attempt - 1));
  return Math.min(d, capMs);
}

export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  sleep: (ms: number) => Promise<void>;
  isCancelled: () => boolean;
};

/**
 * Drives attempts with capped backoff until SUCCESS, a terminal CONFLICT, cancellation, or the attempt
 * budget is exhausted. Returns the final outcome; the caller marks activation complete ONLY on success.
 */
export async function runActivationWithRetry(deps: ActivationDeps, opts: RetryOptions): Promise<AttemptResult> {
  let last: AttemptResult = retry("not-started");
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    if (opts.isCancelled()) return retry("cancelled");
    last = await attemptActivationOnce(deps);
    if (last.kind === "success" || last.kind === "conflict") return last;
    if (attempt < opts.maxAttempts) {
      if (opts.isCancelled()) return retry("cancelled");
      await opts.sleep(backoffDelayMs(attempt, opts.baseDelayMs, opts.maxDelayMs));
    }
  }
  return last;
}
