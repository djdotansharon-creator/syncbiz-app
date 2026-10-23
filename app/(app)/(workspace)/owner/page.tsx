import { OwnerControlPanel } from "@/components/owner-control-panel";
import { WorkspaceBusinessProfileForm } from "@/components/workspace-business-profile-form";
import { getCurrentUserFromCookies } from "@/lib/auth-helpers";
import {
  getWorkspaceBusinessProfileJson,
  sanitizeBusinessProfileForTenant,
} from "@/lib/workspace-business-profile";
import { getTenantRole } from "@/lib/user-store";
import { redirect } from "next/navigation";

export default async function OwnerPage() {
  const user = await getCurrentUserFromCookies();
  if (!user) redirect("/login?from=/owner");

  const role = await getTenantRole(user.id, user.tenantId);
  const canEdit = role === "TENANT_OWNER" || role === "TENANT_ADMIN";
  const rawProfile = await getWorkspaceBusinessProfileJson(user.tenantId);
  const businessProfile = sanitizeBusinessProfileForTenant(rawProfile);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold text-slate-50">Workspace setup</h1>
        <p className="mt-1 text-sm text-slate-400">
          Business identity and AI music context for your catalog, DJ Creator, and recommendations.
        </p>
      </div>

      <WorkspaceBusinessProfileForm
        workspaceId={user.tenantId}
        initialProfile={businessProfile}
        variant="tenant"
        canEdit={canEdit}
      />

      <OwnerControlPanel />
    </div>
  );
}
