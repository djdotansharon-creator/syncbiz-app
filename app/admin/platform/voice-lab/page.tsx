import { requireSuperAdmin } from "@/lib/auth/guards";
import VoiceLabAdmin from "@/components/admin/voice-lab-admin";

/**
 * INTERNAL Voice Lab (super-admin only). The parent layout already enforces
 * requireSuperAdmin(); we re-call for defense-in-depth. This is the SyncBiz team's
 * voice-selection tool — deliberately outside the customer player / Jingles area.
 */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "SyncBiz Admin · Voice Lab",
  robots: { index: false, follow: false },
};

export default async function AdminVoiceLabPage() {
  await requireSuperAdmin();
  return <VoiceLabAdmin />;
}
