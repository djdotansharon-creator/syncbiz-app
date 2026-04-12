"use client";

import { useEffect, useState } from "react";
import type { SourceIconType } from "@/lib/player-utils";
import type { PlayerHeroSurfaceProps } from "@/lib/player-surface/player-hero-types";

function HeroIconBadge({ type }: { type: SourceIconType }) {
  const wrap = "sb-phs-icon-wrap";
  const ic = "sb-phs-icon";
  const title =
    type === "youtube"
      ? "YouTube"
      : type === "soundcloud"
        ? "SoundCloud"
        : type === "local"
          ? "Local"
          : "External";
  return (
    <span className={wrap} title={title}>
      {type === "youtube" && (
        <svg className={`${ic} sb-phs-icon-youtube`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
        </svg>
      )}
      {type === "soundcloud" && (
        <svg className={`${ic} sb-phs-icon-soundcloud`} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <path d="M12 4.5c-1.5 0-2.8.5-3.9 1.2-.5.3-.9.7-1.1 1.2-.2-.1-.4-.1-.6-.1-1.1 0-2 .9-2 2v.1c-1.5.3-2.5 1.5-2.5 3 0 1.7 1.3 3 3 3h6.5c2.2 0 4-1.8 4-4 0-2.2-1.8-4-4-4-.2 0-.4 0-.6.1-.2-1.2-1.2-2.1-2.4-2.1z" />
        </svg>
      )}
      {type === "local" && (
        <svg
          className={`${ic} sb-phs-icon-local`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="4" y="4" width="16" height="16" rx="2" ry="2" />
          <line x1="9" y1="9" x2="15" y2="9" />
          <line x1="9" y1="13" x2="15" y2="13" />
          <line x1="9" y1="17" x2="12" y2="17" />
        </svg>
      )}
      {type === "external" && (
        <svg
          className={`${ic} sb-phs-icon-external`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      )}
    </span>
  );
}

function DefaultMusicArtwork() {
  return (
    <div className="sb-phs-art-fallback-inner" aria-hidden>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
  );
}

function ActiveHero({
  active,
}: {
  active: Extract<PlayerHeroSurfaceProps, { variant: "active" }>["active"];
}) {
  const {
    heroEyebrow,
    title,
    providerLabel,
    detailLine,
    status,
    artworkUrl,
    iconType,
    volume,
    onVolumeChange,
    transport,
    hideInlineTransportAndVolume,
  } = active;

  const [artFailed, setArtFailed] = useState(false);
  useEffect(() => {
    setArtFailed(false);
  }, [artworkUrl]);

  const showImg = Boolean(artworkUrl) && !artFailed;

  const pillClass =
    status === "playing"
      ? "sb-phs-pill sb-phs-pill-playing"
      : status === "paused"
        ? "sb-phs-pill sb-phs-pill-paused"
        : status === "loading"
          ? "sb-phs-pill sb-phs-pill-loading"
          : "sb-phs-pill sb-phs-pill-idle";

  const dotClass =
    status === "playing"
      ? "sb-phs-dot sb-phs-dot-pulse"
      : status === "paused"
        ? "sb-phs-dot sb-phs-dot-amber"
        : "sb-phs-dot";

  const statusText =
    status === "loading" ? "Loading…" : status === "stopped" ? "stopped" : status;

  return (
    <>
      <div className="sb-phs-hero">
        <div className="sb-phs-art-wrap">
          <div className="sb-phs-art-frame">
            {showImg ? (
              <img
                src={artworkUrl!}
                alt=""
                className="sb-phs-art-img"
                onError={() => setArtFailed(true)}
              />
            ) : (
              <DefaultMusicArtwork />
            )}
          </div>
          <div className="sb-phs-badge-wrap">
            <HeroIconBadge type={iconType} />
          </div>
        </div>
        <div className="sb-phs-meta">
          {heroEyebrow ? <p className="sb-phs-eyebrow">{heroEyebrow}</p> : null}
          <h1 className="sb-phs-title">{title}</h1>
          <p className="sb-phs-provider">{providerLabel}</p>
          {detailLine ? <p className="sb-phs-detail">{detailLine}</p> : null}
          <p className={pillClass}>
            <span className={dotClass} />
            <span>{statusText}</span>
          </p>
        </div>
      </div>

      {!hideInlineTransportAndVolume ? (
        <>
          <div className="sb-phs-transport" aria-label="Transport">
            <button
              type="button"
              className="sb-phs-tbtn"
              title="Previous"
              disabled={transport.prevDisabled}
              onClick={transport.onPrev}
            >
              ⏮
            </button>
            <button type="button" className="sb-phs-tbtn" title="Stop" onClick={transport.onStop}>
              ■
            </button>
            <button
              type="button"
              className="sb-phs-tbtn sb-phs-tbtn-play"
              title="Play"
              disabled={transport.playDisabled}
              onClick={transport.onPlay}
            >
              ▶
            </button>
            <button
              type="button"
              className="sb-phs-tbtn"
              title="Pause"
              disabled={transport.pauseDisabled}
              onClick={transport.onPause}
            >
              ⏸
            </button>
            <button
              type="button"
              className="sb-phs-tbtn"
              title="Next"
              disabled={transport.nextDisabled}
              onClick={transport.onNext}
            >
              ⏭
            </button>
          </div>

          <div className="sb-phs-vol">
            <span className="sb-phs-vol-label">VOL</span>
            <input
              type="range"
              min={0}
              max={100}
              value={volume}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              aria-label="Volume"
              className="sb-phs-vol-range"
            />
            <span className="sb-phs-vol-num">{volume}</span>
          </div>
        </>
      ) : null}
    </>
  );
}

/** Presentational hero + inline transport + volume — shared by web PlayerPage and desktop renderer. */
export function PlayerHeroSurface(props: PlayerHeroSurfaceProps) {
  if (props.variant === "empty") {
    const { title, body, hint } = props.empty;
    return (
      <div className="sb-phs-root">
        <div className="sb-phs-empty">
          <h1 className="sb-phs-empty-title">{title}</h1>
          <p className="sb-phs-empty-body">{body}</p>
          {hint ? <p className="sb-phs-empty-hint">{hint}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sb-phs-root">
      <ActiveHero active={props.active} />
    </div>
  );
}
