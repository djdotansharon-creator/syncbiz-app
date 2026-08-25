/**
 * Royalty-Free Music — POC pricing (central config, NOT hardcoded in JSX).
 *
 * POC strategy: each Genre Pack is priced individually, and the Complete Music Bank is a bundle
 * priced far below the sum of packs so the bundle reads as the obvious deal. Change the numbers here
 * only. No Billing/Payments are wired — CTAs stay disabled/"Coming soon" until a payment layer exists.
 */

export const GENRE_PRICE_USD = 4;
export const FULL_BANK_PRICE_USD = 10;

/** Display helper — keep formatting in one place so currency/locale can change later. */
export function formatUsd(amount: number): string {
  return `$${amount}`;
}

export const GENRE_PRICE_LABEL = formatUsd(GENRE_PRICE_USD);
export const FULL_BANK_PRICE_LABEL = formatUsd(FULL_BANK_PRICE_USD);
