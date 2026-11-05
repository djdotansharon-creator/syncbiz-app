"use client";

import { useEffect } from "react";
import { startQueueDiag } from "@/lib/queue-diag";

/** READ-ONLY diagnostic (renders null): writes what moves in the Live Queue (glides, remounted rows, cover loads / decodes) into the desktop main.log. See lib/queue-diag.ts. */
export function QueueDiag() {
  useEffect(() => startQueueDiag(), []);
  return null;
}
