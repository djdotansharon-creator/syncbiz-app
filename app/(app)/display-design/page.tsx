/**
 * Lock screen design (owner 2026-10-26) — a tab of the top bar: the owner arranges what the business's display screen shows (full player or a small square, which icons, clock,
 * next-song notice). A management page like Access Control: managers only, the whole screen, the player row closed (UI only — the music keeps playing).
 */
import { DisplayDesignConsole } from "@/components/management/display-design-console";
import { ManagementGate } from "@/components/management/management-gate";

export default function DisplayDesignPage() {
  return (
    <ManagementGate from="/display-design">
      <div className="mgmt-type h-full overflow-y-auto p-4 sm:p-6">
        <DisplayDesignConsole />
      </div>
    </ManagementGate>
  );
}
