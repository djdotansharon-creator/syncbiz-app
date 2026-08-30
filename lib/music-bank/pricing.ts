/**
 * Royalty-Free Music — DEMO pricing (central config, NOT hardcoded in JSX).
 *
 * Commercial model = MONTHLY SUBSCRIPTION (proposed retail pricing for the demo):
 *   - 1 Genre Pack ............ $4 / month
 *   - Choose any 3 Genre Packs  $10 / month
 *   - Full Music Bank (all 7) . $17 / month   ← BEST VALUE
 *
 * Language rule: one genre = a "Genre Pack"; the whole catalog = "Music Bank" / "Full Music Bank".
 * Never call a single genre a "Music Bank".
 *
 * No Billing/Payments are wired — CTAs stay disabled / "Coming soon" until a payment layer exists.
 * Change the numbers here only.
 */

export const GENRE_PRICE_USD = 4;
export const CHOICE3_PRICE_USD = 10;
export const FULL_BANK_PRICE_USD = 17;

/** How many packs the mid-tier bundle lets the customer choose. */
export const CHOICE3_PACK_COUNT = 3;

/** Billing period for the subscription model. */
export const BILLING_PERIOD = "month" as const;
export const PER_PERIOD_SUFFIX = "/mo"; // compact form for cards
export const PER_PERIOD_LONG = "/month"; // full form for the headline bundle

/** Display helper — keep formatting in one place so currency/locale can change later. */
export function formatUsd(amount: number): string {
  return `$${amount}`;
}

/** Price + compact period, e.g. "$4/mo". */
export function formatMonthly(amount: number): string {
  return `${formatUsd(amount)}${PER_PERIOD_SUFFIX}`;
}

// Compact per-card / per-tier labels (include the /mo so the recurring model is unmistakable).
export const GENRE_PRICE_LABEL = formatMonthly(GENRE_PRICE_USD); // "$4/mo"
export const CHOICE3_PRICE_LABEL = formatMonthly(CHOICE3_PRICE_USD); // "$10/mo"
export const FULL_BANK_PRICE_LABEL = formatMonthly(FULL_BANK_PRICE_USD); // "$17/mo"
