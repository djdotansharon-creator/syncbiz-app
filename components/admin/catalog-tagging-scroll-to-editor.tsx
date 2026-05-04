"use client";

import { useEffect } from "react";

/** Stage 8 — deep-link focus: scroll selected-item editor into view after navigation from coverage dashboard. */
export function CatalogTaggingScrollToEditor({ catalogItemId }: { catalogItemId: string }) {
  useEffect(() => {
    const id = catalogItemId.trim();
    if (!id) return;
    const el = document.getElementById("catalog-tagging-editor-focus");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [catalogItemId]);

  return null;
}
