"use client";

import { useState, useEffect } from "react";
import type { LibraryBrowseCardSurfaceProps } from "@/lib/player-surface/library-browse-types";
import { isSafeHttpCoverUrl } from "@/lib/player-surface/cover-url";

function DefaultArt({
  artworkUrl,
  originBadgeLabel,
}: {
  artworkUrl: string | null;
  originBadgeLabel: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [artworkUrl]);

  const showImg = Boolean(artworkUrl) && !failed;

  return (
    <div className="sb-lbc-art">
      {originBadgeLabel.trim() ? <span className="sb-lbc-origin">{originBadgeLabel}</span> : null}
      {showImg ? (
        <img
          src={artworkUrl!}
          alt=""
          className="sb-lbc-art-img"
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="sb-lbc-fallback" aria-hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function LibraryBrowseCardSurface(props: LibraryBrowseCardSurfaceProps) {
  const {
    as,
    artworkUrl,
    originBadgeLabel = "",
    artSlot,
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
    artworkUrl && isSafeHttpCoverUrl(artworkUrl) ? artworkUrl : null;

  const inner = (
    <>
      {artSlot ?? <DefaultArt artworkUrl={safeUrl} originBadgeLabel={originBadgeLabel} />}
      <div className="sb-lbc-body">
        <div className="sb-lbc-title-row">
          <h3 className="sb-lbc-title">{title}</h3>
          {titleAside ? <div className="sb-lbc-title-aside">{titleAside}</div> : null}
        </div>
        {metaSlot ? (
          <div className="sb-lbc-meta-wrap">{metaSlot}</div>
        ) : metaLine.trim() ? (
          <p className="sb-lbc-meta">{metaLine}</p>
        ) : null}
        {children ? <div className="sb-lbc-footer-slot">{children}</div> : null}
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
