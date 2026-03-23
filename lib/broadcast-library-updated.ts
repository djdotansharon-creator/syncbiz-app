/**
 * Server-side only. Notifies the WS server to broadcast LIBRARY_UPDATED to clients.
 * Call after playlist/radio/source mutations so connected clients refetch library.
 */

function getWsServerHttpUrl(): string {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? process.env.WS_SERVER_HTTP_URL ?? "http://localhost:3001";
  return wsUrl.replace(/^ws(s?):/, "http$1:");
}

export type LibraryEntityType = "playlist" | "source" | "radio";
export type LibraryAction = "created" | "updated" | "deleted";

export async function notifyLibraryUpdated(
  userId: string,
  options?: { branchId?: string; entityType?: LibraryEntityType; action?: LibraryAction }
): Promise<void> {
  if (!userId?.trim()) return;
  const secret = process.env.SYNCBIZ_WS_SECRET ?? process.env.WS_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[broadcast-library-updated] SYNCBIZ_WS_SECRET not set, skipping");
    }
    return;
  }
  try {
    const url = `${getWsServerHttpUrl().replace(/\/$/, "")}/internal/library-updated`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SyncBiz-Secret": secret,
      },
      body: JSON.stringify({
        userId: userId.trim(),
        branchId: options?.branchId?.trim() || "default",
        entityType: options?.entityType,
        action: options?.action,
      }),
    });
    if (!res.ok && process.env.NODE_ENV === "development") {
      console.warn("[broadcast-library-updated] POST failed:", res.status, await res.text());
    }
  } catch (e) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[broadcast-library-updated] fetch error:", e);
    }
  }
}
