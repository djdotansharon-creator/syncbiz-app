"use client";

import { useState, type ReactElement } from "react";
import { RadioIcon } from "@/components/ui/radio-icon";

/**
 * The picture of a station square (owner 2026-10-23): its logo straight on the page — no tile, no frame, no grey behind it.
 * No logo (or the logo does not load) → just the radio icon, nothing around it. Styles: `.sb-rad-art*` in globals.css.
 */
export function RadioArt({ cover }: { cover?: string | null }): ReactElement {
  const [broken, setBroken] = useState<string | null>(null);
  const src = cover && broken !== cover ? cover : null;
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" draggable={false} onError={() => setBroken(src)} />
  ) : (
    <span className="sb-rad-ico">
      <RadioIcon className="h-full w-full" />
    </span>
  );
}
