/**
 * VONO brand lockup (owner 2026-10-13, variant B): the official symbol square + the official wordmark — the same
 * structure the old "SB tile + SyncBiz" had. Assets are the owner's official files (public/brand/), never plain text.
 * Dark UI only (the wordmark is the white version).
 */
/* eslint-disable @next/next/no-img-element */

const SIZES = {
  /** app header: 28px square, 16px wordmark (≈ the old SB tile + name footprint) */
  header: { square: "h-7 w-7 rounded-[7px]", wordmark: "h-4", gap: "gap-1.5" },
  /** login card */
  lg: { square: "h-10 w-10 rounded-[10px]", wordmark: "h-6", gap: "gap-2.5" },
  /** landing page */
  xl: { square: "h-12 w-12 rounded-[12px]", wordmark: "h-7", gap: "gap-3" },
} as const;

export function VonoBrand({ size = "header", hideWordmarkOnMobile = false }: { size?: keyof typeof SIZES; hideWordmarkOnMobile?: boolean }) {
  const s = SIZES[size];
  return (
    <span className={`inline-flex shrink-0 items-center ${s.gap}`}>
      <img src="/brand/vono-app-icon-128.png" alt="" aria-hidden width={128} height={128} className={`block shrink-0 select-none ring-1 ring-white/15 ${s.square}`} draggable={false} />
      <img
        src="/brand/vono-wordmark-white.png"
        alt="VONO"
        width={541}
        height={120}
        className={`w-auto select-none ${s.wordmark} ${hideWordmarkOnMobile ? "hidden sm:block" : "block"}`}
        draggable={false}
      />
    </span>
  );
}
