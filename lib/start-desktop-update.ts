/**
 * The player's "Update" link (the pill's card and the device details) starts the in-app update when this engine can do it (engines with
 * `startUpdate`, owner 2026-11-02); an older engine keeps following the installer link exactly as before.
 *
 * `startUpdate` can answer "I did nothing" (`unsupported`: not a packaged Windows app, `no_info`: the site could not be read / no installer is
 * published yet). The person clicked a link, so in those two cases the old behaviour is restored: the installer / releases link opens in the browser.
 * Every other failure (download, hash, installer start) already offers that link from inside the engine; `not_newer` / `busy` must stay silent.
 */

export type StartUpdateAnswer = { ok: boolean; reason?: string } | undefined | null;
type Bridge = { startUpdate?: () => Promise<StartUpdateAnswer> };

/** the reasons after which NOTHING was done and NOTHING was offered, so the click must still reach the link */
export function needsLinkFallback(answer: StartUpdateAnswer): boolean {
  return !!answer && answer.ok === false && (answer.reason === "unsupported" || answer.reason === "no_info");
}

/**
 * true  = this engine handles the click (the caller must preventDefault);
 * false = this engine cannot update itself (the caller lets the link work as it always did).
 */
export function startDesktopUpdate(fallbackHref: string): boolean {
  if (typeof window === "undefined") return false;
  const bridge = (window as Window & { syncbizDesktop?: Bridge }).syncbizDesktop;
  if (typeof bridge?.startUpdate !== "function") return false;
  const openLink = () => { try { window.open(fallbackHref, "_blank", "noopener,noreferrer"); } catch { /* nothing more to do */ } };
  void bridge.startUpdate().then((a) => { if (needsLinkFallback(a)) openLink(); }, openLink);
  return true;
}
