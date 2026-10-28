"use client";

/**
 * EnrollmentPendingDot — the red circle with a number on the Control Room tab: "a new device is waiting for your approval" (owner 2026-10-28). Shows only to someone who may decide a request,
 * only while enrollment is on, and only when at least one request waits. Display-only: the number comes from the shared summary (lib/use-enrollment-summary.ts). Styles: `.sb-enr-dot` in app/globals.css.
 */

import type { ReactElement } from "react";
import { useLocale } from "@/lib/locale-context";
import { useEnrollmentSummary } from "@/lib/use-enrollment-summary";

export function EnrollmentPendingDot(): ReactElement | null {
  const { locale } = useLocale();
  const { count } = useEnrollmentSummary();
  if (count <= 0) return null;
  const label = locale === "he" ? `${count} בקשות ממתינות לאישור` : `${count} requests waiting for approval`;
  return (
    <span className="sb-enr-dot" role="status" aria-label={label}>
      {count > 9 ? "9+" : count}
    </span>
  );
}
