"use client";

import { HydrationSafeImage } from "@/components/ui/hydration-safe-image";

/**
 * DjVinylArtwork — full-disc picture-disc style vinyl artwork.
 *
 * Visual approach
 * ---------------
 * The cover art fills the ENTIRE disc as a base layer (object-cover).
 * On top sit two compositing layers:
 *   1. Dark radial vignette  — transparent at center 35%, darkens toward
 *      the rim so the artwork reads clearly in the middle and the disc
 *      "rounds off" naturally at the edges without a hard cut.
 *   2. Groove ring texture   — repeating-radial-gradient at ~8 % opacity,
 *      barely perceptible but adds the physical depth of a real record.
 * A small spindle hole sits above everything (z-index, never rotates).
 *
 * Rotation
 * --------
 * The platter wrapper (layers 1-3) gets `.dj-vinyl-spinning` while
 * `isPlaying` is true. The CSS animation is a 2.8 s linear infinite
 * rotation. Removing the class freezes the disc at its current angle.
 *
 * Fallback
 * --------
 * When no cover art is available a deep blue-to-black gradient fills
 * the disc — intentional, not a placeholder box.
 */
export function DjVinylArtwork({
  coverSrc,
  isPlaying,
  size = "lg",
}: {
  coverSrc?: string | null;
  isPlaying?: boolean;
  /** "hero" ≈ 200 px, "xl" ≈ 188 px, "lg" ≈ 192 px, "md" ≈ 176 px */
  size?: "md" | "lg" | "xl" | "hero";
}) {
  const outerSize =
    size === "hero"
      ? "h-[196px] w-[196px] sm:h-[204px] sm:w-[204px]"
      : size === "xl"
        ? "h-[176px] w-[176px] sm:h-[180px] sm:w-[180px]"
        : size === "lg"
          ? "h-48 w-48"
          : "h-44 w-44";

  return (
    <div
      className={`library-deck-art-host flex shrink-0 items-center justify-center rounded-full transition-[filter] duration-300 ${
        isPlaying ? "library-deck-art-host--playing" : "library-deck-art-host--idle"
      }`}
    >
      {/* Matte platter bezel — spin ring removed for CDJ hardware feel */}
      <div
        className={`library-deck-art-inner dj-platter-bezel ${outerSize} relative flex-shrink-0 rounded-full overflow-hidden`}
        aria-hidden
      >
        {/*
         * Spinning platter — all visual layers rotate as one unit.
         * `.dj-vinyl-spinning` is added while playing.
         */}
        <div
          className={`dj-vinyl-platter${isPlaying ? " dj-vinyl-spinning" : ""}`}
        >
          {/* Layer 1: Artwork fills the full disc */}
          {coverSrc ? (
            <HydrationSafeImage
              src={coverSrc}
              alt=""
              className="absolute inset-0 h-full w-full rounded-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 rounded-full dj-vinyl-fallback" />
          )}

          {/* Layer 2: Radial vignette — darkens toward rim, artwork shows in center */}
          <div className="absolute inset-0 rounded-full dj-vinyl-vignette" />

          {/* Layer 3: Groove ring texture */}
          <div className="absolute inset-0 rounded-full dj-vinyl-grooves" />
        </div>

        {/* Spindle — above the platter, never rotates */}
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full dj-vinyl-spindle"
        />
      </div>
    </div>
  );
}
