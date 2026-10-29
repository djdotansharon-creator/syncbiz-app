"use client";

/**
 * A QR code drawn as ONE SVG path (crisp at any size, no image file, no network): the vendored generator (lib/vendor/qrcode-generator.js, MIT) builds the module matrix, this draws it dark on a white
 * rounded tile with the quiet zone a phone camera needs. Display only.
 */

import { useMemo } from "react";
import qrcode from "@/lib/vendor/qrcode-generator";

export function QrCode({ value, size = 208, label }: { value: string; size?: number; label?: string }) {
  const svg = useMemo(() => {
    try {
      const qr = qrcode(0, "M"); // type 0 = the smallest version that fits; error correction M (15 %)
      qr.addData(value, "Byte");
      qr.make();
      const n = qr.getModuleCount();
      const quiet = 3;
      let d = "";
      for (let r = 0; r < n; r++) {
        let c = 0;
        while (c < n) {
          if (!qr.isDark(r, c)) {
            c++;
            continue;
          }
          let run = 1; // one rectangle per horizontal run keeps the path short
          while (c + run < n && qr.isDark(r, c + run)) run++;
          d += `M${c + quiet} ${r + quiet}h${run}v1h-${run}z`;
          c += run;
        }
      }
      return { n: n + quiet * 2, d };
    } catch {
      return null;
    }
  }, [value]);
  if (!svg) return null;
  return (
    <svg viewBox={`0 0 ${svg.n} ${svg.n}`} width={size} height={size} role="img" aria-label={label ?? "QR code"} shapeRendering="crispEdges" style={{ display: "block", borderRadius: 18, background: "#fff" }}>
      <path d={svg.d} fill="#0a0a0a" />
    </svg>
  );
}
