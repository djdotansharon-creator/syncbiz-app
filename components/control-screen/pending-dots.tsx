"use client";

/** The red circles of the control screen (owner 2026-10-30): people waiting to join (on Permissions) and devices waiting for approval (on the Control Room); `AnyPendingDot` adds both for the ways in. Display-only. */

import type { ReactElement } from "react";
import { useLocale } from "@/lib/locale-context";
import { useEnrollmentSummary } from "@/lib/use-enrollment-summary";
import { useJoinPending } from "@/lib/use-join-pending";

function Dot({ count, he, en }: { count: number; he: string; en: string }): ReactElement | null {
  const { locale } = useLocale();
  if (count <= 0) return null;
  return (
    <span className="sb-enr-dot" role="status" aria-label={(locale === "he" ? he : en).replace("{n}", String(count))}>
      {count > 9 ? "9+" : count}
    </span>
  );
}

export function JoinPendingDot(): ReactElement | null {
  const { count } = useJoinPending();
  return <Dot count={count} he="{n} אנשים מבקשים להצטרף" en="{n} people ask to join" />;
}

export function AnyPendingDot(): ReactElement | null {
  const { count: join } = useJoinPending();
  const { count: devices } = useEnrollmentSummary();
  return <Dot count={join + devices} he="{n} בקשות ממתינות לאישור" en="{n} requests waiting for approval" />;
}
