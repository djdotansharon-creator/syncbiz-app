import type { ReactNode } from "react";

import { SourcesManagerClient } from "@/components/sources-manager-client";
import { fetchUnifiedSourcesForServerComponent } from "@/lib/server-unified-sources-fetch";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import { getCanonicalLegacyBranchId } from "@/lib/branch-resolver";

/**
 * Desktop player workspace: shared left/right rails from SourcesManager;
 * route `children` render in the center column (library uses an empty page and
 * keeps the default center from pathname === `/sources`).
 */
export default async function PlayerWorkspaceLayout({ children }: { children: ReactNode }) {
  const allSources = await fetchUnifiedSourcesForServerComponent();
  const sources = allSources.filter((s) => s.origin !== "radio");
  // the legacy key "default" is this business's canonical branch when it has one — the library needs it to tell which local playlists belong to THIS computer's branch (lib/library-branch-scope.ts)
  let defaultBranchId: string | null = null;
  try {
    const user = await getCurrentUserFromCookies();
    defaultBranchId = user?.tenantId ? await getCanonicalLegacyBranchId(user.tenantId) : null;
  } catch {
    defaultBranchId = null;
  }

  return (
    <SourcesManagerClient
      initialSources={sources}
      defaultBranchId={defaultBranchId}
      playerWorkspaceMode
      workspaceRouteCenter={children}
    />
  );
}
