/**
 * Server-side only. Syncs a permanent-MASTER designation change to the WS server's authoritative store so it
 * survives WS restart independently of client tokens. The DB (BranchMasterDesignation) remains the source of
 * truth; call this right after writing it. Mirrors lib/broadcast-library-updated.ts (same internal secret).
 */
function getWsServerHttpUrl(): string {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? process.env.WS_SERVER_HTTP_URL ?? "http://localhost:3001";
  return wsUrl.replace(/^ws(s?):/, "http$1:");
}

/**
 * Returns TRUE only when the WS server durably accepted + persisted the change (HTTP 2xx). Returns FALSE on a
 * missing secret, a network error, or a non-2xx response — the admin action is idempotent, so the caller should
 * surface the failure and the admin can simply retry. Never throws.
 */
export async function syncBranchMasterDesignation(input: {
  workspaceId: string;
  branchId: string;
  /** The designated durable device id, or null to CLEAR the designation. */
  durableDeviceId: string | null;
}): Promise<boolean> {
  if (!input.workspaceId?.trim() || !input.branchId?.trim()) return false;
  const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[broadcast-branch-master-designation] SYNCBIZ_WS_SECRET not set, skipping");
    }
    return false;
  }
  try {
    const url = `${getWsServerHttpUrl().replace(/\/$/, "")}/internal/branch-master-designation`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-SyncBiz-Secret": secret },
      body: JSON.stringify({
        workspaceId: input.workspaceId.trim(),
        branchId: input.branchId.trim(),
        durableDeviceId: input.durableDeviceId,
      }),
    });
    if (!res.ok && process.env.NODE_ENV === "development") {
      console.warn("[broadcast-branch-master-designation] POST failed:", res.status, await res.text());
    }
    return res.ok;
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[broadcast-branch-master-designation] fetch error:", e);
    }
    return false;
  }
}
