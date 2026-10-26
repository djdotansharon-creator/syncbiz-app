"use client";

import { useState, useEffect } from "react";
import { useTrimmedCover } from "@/lib/cover-trim";

/**
 * Renders cover images in a hydration-safe way.
 * - Defers <img> until after mount to avoid browser-extension DOM mutations (e.g. data-first-enter-image)
 * - Uses React state for onError instead of DOM mutation for deterministic updates
 */
export function HydrationSafeImage({
  src,
  alt = "",
  className,
  ...props
}: React.ImgHTMLAttributes<HTMLImageElement>) {
  const [mounted, setMounted] = useState(false);
  const [errored, setErrored] = useState(false);
  /* 2026-10-18 (owner): covers with a light frame baked into the artwork are shown without it (lib/cover-trim.ts) */
  const shown = useTrimmedCover(typeof src === "string" ? src : undefined);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!src || errored) {
    return <div className={className} style={{ background: "linear-gradient(to bottom right, rgb(51 65 85), rgb(15 23 42))" }} aria-hidden />;
  }

  if (!mounted) {
    return <div className={className} style={{ background: "linear-gradient(to bottom right, rgb(51 65 85), rgb(15 23 42))" }} aria-hidden />;
  }

  return (
    <img
      src={shown || src}
      alt={alt}
      className={className}
      onError={() => setErrored(true)}
      {...props}
    />
  );
}
