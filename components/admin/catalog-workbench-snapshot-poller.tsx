"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

const POLL_MS = 2500;
const MAX_POLLS = 48;

/**
 * While the server awaits bounded intake, poll latest snapshot until a row appears, then refresh RSC payload once.
 * Does not trigger refresh POST — avoids duplicate fetches when SUCCESS/PARTIAL already exists.
 */
export function CatalogWorkbenchSnapshotPoller({
  catalogItemId,
  enabled,
}: {
  catalogItemId: string;
  enabled: boolean;
}) {
  const router = useRouter();
  const polls = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    polls.current = 0;
    const id = window.setInterval(async () => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        window.clearInterval(id);
        return;
      }
      try {
        const res = await fetch(`/api/admin/platform/catalog-items/${catalogItemId}/source-metadata/latest`, {
          credentials: "same-origin",
        });
        if (!res.ok) return;
        const j = (await res.json()) as { snapshot?: unknown };
        if (j.snapshot != null) {
          window.clearInterval(id);
          router.refresh();
        }
      } catch {
        /* ignore transient errors */
      }
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [catalogItemId, enabled, router]);

  return null;
}
