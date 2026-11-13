/**
 * SECURITY (C5/C6b, 2026-11-13) — renderer-facing config redaction. PURE (no electron / fs / net), so it is
 * unit-testable (`desktop/scripts/verify-renderer-config-redact.ts`).
 *
 * The desktop main window loads a REMOTELY-HOSTED renderer. The `syncbizDesktop` preload bridge returns the
 * runtime config to that renderer via getConfig / saveConfig / signIn. The config holds `wsToken` — the signed
 * station bearer token (its MASTER credential). A compromised / XSS'd renderer must therefore NEVER be able to:
 *   (a) read `wsToken` back (token exfiltration), or
 *   (b) repoint the station's control plane (apiBaseUrl / wsUrl) or inject/erase the token via a saved patch.
 *
 * `toRendererConfig` strips the token from every value RETURNED to the renderer (keeps a boolean `hasWsToken`
 * for the UI). `sanitizeConfigPatch` strips the dangerous fields from a patch COMING FROM a remote renderer.
 * The legacy LOCAL (file://) settings page is trusted and keeps full control (see `isRemoteSender` in ipc-mvp).
 */
import type { DesktopRuntimeConfig, MvpConfigPatch, RendererRuntimeConfig } from "./mvp-types";

/** Project the runtime config to the renderer-safe shape: drop `wsToken`, expose only `hasWsToken`. */
export function toRendererConfig(cfg: DesktopRuntimeConfig): RendererRuntimeConfig {
  const { wsToken, ...rest } = cfg;
  return { ...rest, hasWsToken: typeof wsToken === "string" && wsToken.trim().length > 0 };
}

/**
 * Sanitize an inbound SAVE_CONFIG patch.
 *  - A blank/whitespace `wsToken` is ALWAYS dropped (treated as "no change"), so a stale/empty form field can
 *    never erase the stored station token — for any sender.
 *  - When `remote` (the patch came from the hosted http(s) renderer), the endpoints (`apiBaseUrl`/`wsUrl`) and
 *    the token are dropped entirely: the untrusted renderer may change only benign settings (music folder,
 *    workspace label, playback prefs…). The station's endpoints come from activation/config, and its token
 *    from the sanctioned `applyDesktopAuth` handoff — never from a renderer-driven saveConfig.
 */
export function sanitizeConfigPatch(patch: MvpConfigPatch, remote: boolean): MvpConfigPatch {
  const out: MvpConfigPatch = { ...patch };
  if (typeof out.wsToken === "string" && !out.wsToken.trim()) delete out.wsToken;
  if (remote) {
    delete out.apiBaseUrl;
    delete out.wsUrl;
    delete out.wsToken;
  }
  return out;
}
