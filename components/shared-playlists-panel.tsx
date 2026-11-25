"use client";

/**
 * "Shared" in the library (owner 2026-11-22, sharing phase C): the playlists that were shared INTO this branch and accepted — live. Tiles (picture, name, who made it / who shared it); a click opens the playlist in
 * the album look: play it, nothing else (no ⋯, no classic view). A song that is a file on another computer is drawn grey and says so when pressed. "Stop following" lets the branch leave the share.
 * Lives in the library's center monitor like Radio.
 */
import { useMemo, useState, type ReactElement } from "react";
import { PlaylistWorkspacePanel } from "@/components/playlist-workspace-panel";
import { useLocale } from "@/lib/locale-context";
import { isLocalOnlyLeaf, sharedPlaylistLeaves } from "@/lib/shared-playlist-source";
import type { UnifiedSource } from "@/lib/source-types";
import type { ShareView } from "@/lib/use-playlist-shares";

const HE = {
  empty: "עדיין לא שותף כלום עם הסניף הזה.",
  hint: "כשמישהו ישתף איתכם פלייליסט ותאשרו, הוא יופיע כאן וימשיך להתעדכן.",
  by: "נוצר על ידי",
  sharedBy: "שותף על ידי",
  songs: (n: number) => (n === 1 ? "שיר אחד" : `${n} שירים`),
  stop: "הפסקת מעקב",
  offline: "קובץ מקומי לא נמצא",
  back: "חזרה למשותפים",
};
const EN = {
  empty: "Nothing is shared with this branch yet.",
  hint: "When someone shares a playlist with you and you accept it, it shows up here and keeps updating.",
  by: "created by",
  sharedBy: "shared by",
  songs: (n: number) => (n === 1 ? "1 song" : `${n} songs`),
  stop: "Stop following",
  offline: "Local file not found",
  back: "Back to shared",
};

const toast = (message: string) => window.dispatchEvent(new CustomEvent("syncbiz:toast", { detail: { message } }));

export function SharedPlaylistsPanel({
  shares,
  activeId,
  onPlayLeaf,
  onPlayAll,
  onLeave,
}: {
  shares: ShareView[];
  activeId: string | null;
  onPlayLeaf: (leaf: UnifiedSource, all: UnifiedSource[]) => void;
  onPlayAll: (all: UnifiedSource[]) => void;
  onLeave: (shareId: string) => Promise<void>;
}): ReactElement {
  const { locale } = useLocale();
  const he = locale === "he";
  const t = he ? HE : EN;
  const [openId, setOpenId] = useState<string | null>(null);
  const open = shares.find((s) => s.id === openId) ?? null;
  const leaves = useMemo(() => (open?.playlist ? sharedPlaylistLeaves(open.playlist) : []), [open]);

  if (open?.playlist) {
    const pl = open.playlist;
    return (
      <PlaylistWorkspacePanel
        mode="shared"
        title={pl.name}
        cover={pl.cover || pl.thumbnail || null}
        createdBy={pl.createdByName ?? null}
        items={leaves}
        activeId={activeId}
        onBack={() => setOpenId(null)}
        onPlayAll={() => onPlayAll(leaves.filter((l) => !isLocalOnlyLeaf(l)))}
        onPlayItem={(leaf) => onPlayLeaf(leaf, leaves.filter((l) => !isLocalOnlyLeaf(l)))}
        unavailable={isLocalOnlyLeaf}
        onUnavailable={() => toast(t.offline)}
        extra={
          <>
            <span>
              {t.sharedBy} {open.fromName ?? "—"}
              {open.fromBusiness ? ` · ${open.fromBusiness}` : ""}
            </span>
            <button
              type="button"
              onClick={() => {
                setOpenId(null);
                void onLeave(open.id);
              }}
            >
              {t.stop}
            </button>
          </>
        }
      />
    );
  }

  return (
    <div dir={he ? "rtl" : "ltr"} className="sb-shr-panel">
      {shares.length === 0 ? (
        <div className="sb-shr-empty">
          <p>{t.empty}</p>
          <p className="sb-shr-hint">{t.hint}</p>
        </div>
      ) : (
        <ul className="sb-shr-grid">
          {shares.map((s) => {
            const pl = s.playlist!;
            return (
              <li key={s.id}>
                <button type="button" className="sb-shr-tile" onClick={() => setOpenId(s.id)}>
                  <span className="sb-shr-art">
                    {pl.cover || pl.thumbnail ? <img src={pl.cover || pl.thumbnail} alt="" loading="lazy" draggable={false} /> : <span className="sb-alb-initial">{pl.name.charAt(0)}</span>}
                  </span>
                  <span className="sb-shr-name" title={pl.name}>
                    {pl.name}
                  </span>
                  <span className="sb-shr-sub">
                    {pl.createdByName ? (
                      <>
                        {t.by} <b>{pl.createdByName}</b> ·{" "}
                      </>
                    ) : null}
                    {t.songs(sharedPlaylistLeaves(pl).length)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
