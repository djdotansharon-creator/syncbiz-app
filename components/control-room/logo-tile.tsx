"use client";

import type { CSSProperties } from "react";
import { LOGO_AS_IS, useLogoFit } from "@/components/control-room/logo-fit";

/**
 * Control Room — the square logo tile of a branch / brand (the same drawing the list rows use): the logo trimmed and fitted on the colour it carries, or the brand colour + its initial.
 * The size comes from `--cr-logo` on the tile or any ancestor. Styles: `.cr-row-logo*` in globals.css.
 */
export function LogoTile({ src, color, initial }: { src: string | null | undefined; color: string; initial: string }) {
  const logoSrc = src || "";
  const fit = useLogoFit(logoSrc || null);
  const asis = LOGO_AS_IS && !!logoSrc && fit !== null;
  return (
    <span
      className={`cr-row-logo ${logoSrc ? "has-logo" : ""}${asis ? " is-asis" : fit ? " has-fit" : ""}${!asis && fit?.bleed ? " is-bleed" : ""}${logoSrc && fit === undefined ? " is-loading" : ""}`}
      style={{ ["--cr-brand" as string]: color, ...(!asis && fit ? { background: fit.bg } : {}) } as CSSProperties}
      aria-hidden
    >
      {logoSrc ? (
        fit === undefined ? null : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={fit?.src ?? logoSrc} alt="" draggable={false} />
        )
      ) : (
        <span className="cr-row-initial">{initial}</span>
      )}
    </span>
  );
}
