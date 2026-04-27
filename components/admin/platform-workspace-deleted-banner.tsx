"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

/**
 * Shown when redirecting from workspace drill-down after a successful
 * `delete-test` — URL carries `?wsDeleted=1` once; we strip the param and
 * show a one-shot success line.
 */
function BannerInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (searchParams.get("wsDeleted") === "1") {
      setVisible(true);
      router.replace("/admin/platform", { scroll: false });
    }
  }, [searchParams, router]);

  if (!visible) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200"
    >
      The workspace was deleted successfully. Platform audit contains a <code className="text-xs">workspace.test_delete</code> event.
    </div>
  );
}

export default function PlatformWorkspaceDeletedBanner() {
  return (
    <Suspense fallback={null}>
      <BannerInner />
    </Suspense>
  );
}
