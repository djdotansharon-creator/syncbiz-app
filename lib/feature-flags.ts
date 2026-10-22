/**
 * Public feature flags (NEXT_PUBLIC_*, inlined at build time — NOT secrets).
 *
 * Fail-closed: a flag is ON only when its env var is exactly the string "true".
 * Undefined / missing / any other value → OFF. On Railway production these vars are unset,
 * so every gated feature is OFF unless a build explicitly opts in (e.g. local dev via .env.local).
 */

/**
 * Royalty-Free Music catalog (POC). ON in local dev, OFF in production until the Streaming layer
 * makes it actually playable for customers. Gates BOTH the PAD launcher and the center panel.
 */
export const RFM_CATALOG_ENABLED = process.env.NEXT_PUBLIC_RFM_CATALOG_ENABLED === "true";

/**
 * Shufersal pilot demo bank (separate from the Royalty-Free bank). OFF by default — the launcher pad and
 * the center panel are absent entirely until this is exactly "true". The DB rows + /api/media serving are
 * independent of this flag; this gates UI visibility only.
 */
export const SHUFERSAL_BANK_ENABLED = process.env.NEXT_PUBLIC_SHUFERSAL_BANK_ENABLED === "true";

/**
 * Who sees the Shufersal bank (owner 2026-10-22: only Shufersal / the owner, never every customer).
 * NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES = comma-separated workspace ids, or "*" for every workspace.
 * Fail-closed: unset / empty → nobody, even with the flag on.
 */
const SHUFERSAL_BANK_WORKSPACES = (process.env.NEXT_PUBLIC_SHUFERSAL_BANK_WORKSPACES ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function shufersalBankVisibleFor(workspaceId: string | null): boolean {
  if (!SHUFERSAL_BANK_ENABLED) return false;
  if (SHUFERSAL_BANK_WORKSPACES.includes("*")) return true;
  return !!workspaceId && SHUFERSAL_BANK_WORKSPACES.includes(workspaceId);
}
