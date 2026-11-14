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
 *  - When `remote` (the patch came from the hosted http(s) renderer), these fields are dropped entirely:
 *      • `apiBaseUrl` / `wsUrl` / `wsToken` — the untrusted renderer must not repoint the station or inject a token;
 *      • `musicFolderPath` / `additionalMusicFolders` / `localMetadataBankPath` — the approved LOCAL file-access
 *        roots (C5 step 3). These are set ONLY by the trusted OS-dialog handlers (pickMusicFolder /
 *        addAdditionalMusicFolder / pickLocalMetadataBankFolder), which persist them directly. A remote renderer
 *        must not widen file access by patching a root path here (that would defeat authorizeLocalRead).
 *    The renderer may still change benign settings (workspace label, playback prefs, branchId for activation…).
 *    The station's endpoints come from activation/config, and its token from the sanctioned `applyDesktopAuth`.
 */
export function sanitizeConfigPatch(patch: MvpConfigPatch, remote: boolean): MvpConfigPatch {
  const out: MvpConfigPatch = { ...patch };
  if (typeof out.wsToken === "string" && !out.wsToken.trim()) delete out.wsToken;
  if (remote) {
    delete out.apiBaseUrl;
    delete out.wsUrl;
    delete out.wsToken;
    delete out.musicFolderPath;
    delete out.additionalMusicFolders;
    delete out.localMetadataBankPath;
  }
  return out;
}
