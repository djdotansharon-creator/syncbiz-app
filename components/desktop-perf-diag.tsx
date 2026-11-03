"use client";

import { useEffect } from "react";
import { startDesktopPerfDiag } from "@/lib/desktop-perf-diag";

/** READ-ONLY performance diagnostic (renders null): writes slow clicks / long frames / the hardware into the desktop main.log. See lib/desktop-perf-diag.ts. */
export function DesktopPerfDiag() {
  useEffect(() => startDesktopPerfDiag(), []);
  return null;
}
