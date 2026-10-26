import { ManagementTabs } from "@/components/management/management-tabs";

/** shown at once while the page loads (a tab switch never leaves a blank screen); the tabs stay exactly where they are */
export default function Loading() {
  return (
    <div className="mgmt-type h-full overflow-y-auto p-4 sm:p-6">
      <div className="mb-4"><ManagementTabs /></div>
      <div className="cr-skel-grid" aria-hidden>
        <div className="cr-skel" /><div className="cr-skel" /><div className="cr-skel" /><div className="cr-skel" />
      </div>
    </div>
  );
}
