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
