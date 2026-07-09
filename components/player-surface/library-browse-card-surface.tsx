"use client";

import { useState, useEffect, type ReactNode } from "react";
import type { LibraryBrowseCardSurfaceProps } from "@/lib/player-surface/library-browse-types";
import type { TrackSourceChip } from "@/lib/track-source-chip";
import { CompactSourceBadge, TrackMediaPlaceholder } from "@/components/track-source-visual";
import { isSafeLibraryCoverUrl } from "@/lib/player-surface/cover-url";

function DefaultArt({
  artworkUrl,
  originBadgeLabel,
  originBadgeClassName = "",
  topRightSlot,
  mediaPlaceholderChip,
}: {
  artworkUrl: string | null;
  originBadgeLabel: string;
  originBadgeClassName?: string;
  topRightSlot?: ReactNode;
  mediaPlaceholderChip?: TrackSourceChip;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [artworkUrl]);

  const showImg = Boolean(artworkUrl) && !failed;

  return (
    <div className="sb-lbc-art">
      {originBadgeLabel.trim() ? (
        <span className={`sb-lbc-origin ${originBadgeClassName}`.trim()}>{originBadgeLabel}</span>
      ) : null}
      {showImg ? (
        <>
          <img
            src={artworkUrl!}
            alt=""
            className="sb-lbc-art-img"
            loading="lazy"
            decoding="async"
            onError={() => setFailed(true)}
          />
          {mediaPlaceholderChip ? (
            <span className="pointer-events-none absolute bottom-2 left-2 z-[2]">
              <CompactSourceBadge chip={mediaPlaceholderChip} />
            </span>
          ) : null}
        </>
      ) : mediaPlaceholderChip ? (
        <TrackMediaPlaceholder chip={mediaPlaceholderChip} className="absolute inset-0" showCornerBadge={false} />
      ) : (
        <div className="sb-lbc-fallback" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
      {topRightSlot ? (
        <div className="pointer-events-none absolute right-2 top-2 z-[2] [&_button]:pointer-events-auto [&_span]:pointer-events-auto">
          {topRightSlot}
        </div>
      ) : null}
    </div>
  );
}

export function LibraryBrowseCardSurface(props: LibraryBrowseCardSurfaceProps) {
  const {
    as,
    artworkUrl,
    mediaPlaceholderChip,
    originBadgeLabel = "",
    originBadgeClassName = "",
    artSlot,
    artTopRightSlot,
    title,
    metaLine,
    metaSlot,
    titleAside,
    selected,
    className = "",
    children,
    onClick,
    disabled,
    "aria-label": ariaLabel,
    "aria-pressed": ariaPressed,
    type = "button",
  } = props;

  const safeUrl =
    artworkUrl && isSafeLibraryCoverUrl(artworkUrl) ? artworkUrl : null;

  const inner = (
    <>
      {artSlot ?? (
        <DefaultArt
          artworkUrl={safeUrl}
          originBadgeLabel={originBadgeLabel}
          originBadgeClassName={originBadgeClassName}
          topRightSlot={artTopRightSlot}
          mediaPlaceholderChip={mediaPlaceholderChip}
        />
      )}
      <div className="sb-lbc-body">
        <div className="sb-lbc-title-row">
          <h3 className="sb-lbc-title">{title}</h3>
          {titleAside ? <div className="sb-lbc-title-aside">{titleAside}</div> : null}
        </div>
        {children ? <div className="sb-lbc-footer-slot">{children}</div> : null}
        {metaSlot ? (
          <div className="sb-lbc-meta-wrap">{metaSlot}</div>
        ) : metaLine.trim() ? (
          <p className="sb-lbc-meta">{metaLine}</p>
        ) : null}
      </div>
    </>
  );

  const shell = selected ? "sb-lbc-shell sb-lbc-shell-selected" : "sb-lbc-shell";

  if (as === "button") {
    return (
      <button
        type={type}
        className={`${shell} sb-lbc-as-button ${className}`.trim()}
        onClick={onClick}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-pressed={ariaPressed}
      >
        {inner}
      </button>
    );
  }

  return (
    <div className={`${shell} sb-lbc-as-div ${className}`.trim()} onClick={onClick} role={onClick ? "presentation" : undefined}>
      {inner}
    </div>
  );
}
