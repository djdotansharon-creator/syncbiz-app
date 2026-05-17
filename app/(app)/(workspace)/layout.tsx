import type { ReactNode } from "react";

import { SourcesManagerClient } from "@/components/sources-manager-client";
import { fetchUnifiedSourcesForServerComponent } from "@/lib/server-unified-sources-fetch";

/**
 * Desktop player workspace: shared left/right rails from SourcesManager;
 * route `children` render in the center column (library uses an empty page and
 * keeps the default center from pathname === `/sources`).
 */
export default async function PlayerWorkspaceLayout({ children }: { children: ReactNode }) {
  const allSources = await fetchUnifiedSourcesForServerComponent();
  const sources = allSources.filter((s) => s.origin !== "radio");

  return (
    <SourcesManagerClient
      initialSources={sources}
      playerWorkspaceMode
      workspaceRouteCenter={children}
    />
  );
}
