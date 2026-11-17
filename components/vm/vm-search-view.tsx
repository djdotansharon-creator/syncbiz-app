"use client";

import type { YouTubeSearchResult } from "@/lib/search-service";
import { formatDuration } from "@/lib/format-utils";
import { useTranslations } from "@/lib/locale-context";
import { useTr } from "@/lib/i18n/use-tr";
import type { UnifiedSource } from "@/lib/source-types";
import { useVmUi } from "@/components/vm/vm-ui";
import { VmCover } from "@/components/vm/vm-parts";
import { useOpenActions } from "@/components/vm/vm-actions";
import { VmSourceRow, useSendSource } from "@/components/vm/vm-source-row";
import { IconLink, IconMore, IconPlay, IconPlus, IconSearch, IconUpNext } from "@/components/vm/vm-icons";

/**
 * The phone's search screen (owner 2026-11-17: rows without frames or button rows; tap plays, ⋯ has the rest). The search itself — typing, the library + YouTube lookup, adding a
 * found song to the library, what "play" means for a found song — is `MobileSearchBar`'s, unchanged; this is only how its results are drawn.
 */
export type VmSearchViewProps = {
  query: string;
  onQuery: (q: string) => void;
  placeholder: string;
  hasQuery: boolean;
  searching: boolean;
  internal: UnifiedSource[];
  youtube: YouTubeSearchResult[];
  onPlayYoutube: (r: YouTubeSearchResult) => void;
  onQueueYoutube: (r: YouTubeSearchResult) => void;
  onAddYoutube: (r: YouTubeSearchResult) => void;
  onCopy: (url: string) => void;
};

function YoutubeRow({ r, p }: { r: YouTubeSearchResult; p: VmSearchViewProps }) {
  const tr = useTr();
  const ui = useVmUi();
  const { t } = useTranslations();
  const send = useSendSource();
  const openActions = useOpenActions();
  const sub = r.durationSeconds != null && r.durationSeconds > 0 ? `YouTube · ${formatDuration(r.durationSeconds)}` : "YouTube";
  // a found song is added to the library when it is played: never on a tap that has nowhere to go (no branch open / the branch is offline)
  const play = () => {
    if (send.guard()) p.onPlayYoutube(r);
  };
  const queue = () => {
    if (send.guard()) p.onQueueYoutube(r);
  };
  const menu = () =>
    openActions({
      cover: r.cover || null,
      title: r.title,
      sub,
      actions: [
        { key: "now", icon: <IconPlay />, label: tr("Play now"), run: play },
        { key: "next", icon: <IconUpNext />, label: tr("Play next"), run: queue },
        { key: "add", icon: <IconPlus />, label: t.addToLibrary, run: () => p.onAddYoutube(r) },
        {
          key: "copy",
          icon: <IconLink />,
          label: tr("Copy link"),
          run: () => {
            p.onCopy(r.url);
            ui.toast(tr("Link copied"));
          },
        },
      ],
      details: [
        { label: tr("Type"), value: tr("Song") },
        ...(r.durationSeconds != null && r.durationSeconds > 0 ? [{ label: tr("Length"), value: formatDuration(r.durationSeconds) }] : []),
        { label: tr("Source"), value: "YouTube" },
      ],
    });
  return (
    <div className="vm-src">
      <button type="button" className="vm-src-main" onClick={play}>
        <VmCover src={r.cover || null} name={r.title} size={52} radius={12} />
        <span className="vm-src-text">
          <span className="vm-src-title vm-bdi">{r.title}</span>
          <span className="vm-src-sub vm-bdi">{sub}</span>
        </span>
      </button>
      <button type="button" className="vm-more" onClick={menu} aria-label={tr("More")}>
        <IconMore />
      </button>
    </div>
  );
}

export function VmSearchView(p: VmSearchViewProps) {
  const tr = useTr();
  const { t } = useTranslations();
  const hasResults = p.internal.length > 0 || p.youtube.length > 0;
  return (
    <div className="vm-search">
      <label className="vm-field" style={{ margin: 0 }}>
        <IconSearch />
        <input
          type="search"
          value={p.query}
          onChange={(e) => p.onQuery(e.target.value)}
          placeholder={p.placeholder}
          aria-label={tr("Search")}
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      {p.hasQuery ? (
        p.searching && !hasResults ? (
          <div className="vm-list" style={{ marginTop: 14, paddingInline: 0 }} aria-busy>
            <div className="vm-skel" style={{ height: 64 }} />
            <div className="vm-skel" style={{ height: 64 }} />
          </div>
        ) : hasResults ? (
          <>
            {p.internal.length ? (
              <>
                <div className="vm-sec" style={{ marginInline: 6 }}>{t.localResults}</div>
                {p.internal.map((s) => (
                  <VmSourceRow key={`${s.origin}:${s.id}`} source={s} href={s.origin === "playlist" ? `/mobile/library/playlist/${encodeURIComponent(s.id)}` : null} />
                ))}
              </>
            ) : null}
            {p.youtube.length ? (
              <>
                <div className="vm-sec" style={{ marginInline: 6 }}>{t.youtubeResults}</div>
                {p.youtube.map((r, i) => (
                  <YoutubeRow key={`yt-${i}`} r={r} p={p} />
                ))}
              </>
            ) : null}
          </>
        ) : (
          <div className="vm-empty" style={{ marginTop: 40 }}>
            <h2>{tr("Nothing found")}</h2>
            <span>{tr("Try another word.")}</span>
          </div>
        )
      ) : null}
    </div>
  );
}
