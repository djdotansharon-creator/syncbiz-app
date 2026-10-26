/**
 * Access Control → Display screen (owner 2026-10-25): the owner's password for the store's display screen and what staff may do on it.
 * Under /access-control so it is a Management Mode page: full screen, no player row, black or white by the display mode — and the music keeps playing.
 */
import { DisplaySettingsConsole } from "@/components/management/display-settings-console";
import { ManagementGate } from "@/components/management/management-gate";
import { ManagementTabs } from "@/components/management/management-tabs";

export default function DisplaySettingsPage() {
  return (
    <ManagementGate from="/access-control/display">
      <div className="mgmt-type h-full overflow-y-auto p-4 sm:p-6">
        <div className="mb-4"><ManagementTabs /></div>
        <DisplaySettingsConsole />
      </div>
    </ManagementGate>
  );
}
