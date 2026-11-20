import type { ReactNode, SVGProps } from "react";

/**
 * The phone app's icon set (frameless, 1.8 stroke, 24px grid) — one place, so every screen draws the same hand.
 * `fill` icons (play / pause / transport) are solid like Apple Music's; the rest are outline.
 */
function Svg({ children, solid = false, ...p }: SVGProps<SVGSVGElement> & { children: ReactNode; solid?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill={solid ? "currentColor" : "none"}
      stroke={solid ? "none" : "currentColor"}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...p}
    >
      {children}
    </svg>
  );
}

export const IconStore = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 9.5 5.4 4.6A1 1 0 0 1 6.36 4h11.28a1 1 0 0 1 .96.6L20 9.5" />
    <path d="M4 9.5a2.67 2.67 0 0 0 5.33 0 2.67 2.67 0 0 0 5.34 0A2.67 2.67 0 0 0 20 9.5" />
    <path d="M5.5 12.5V20h13v-7.5" />
    <path d="M10 20v-4.5h4V20" />
  </Svg>
);
export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M3.8 11.2 12 4l8.2 7.2" />
    <path d="M6 9.6V19a1 1 0 0 0 1 1h3.4v-5.2h3.2V20H17a1 1 0 0 0 1-1V9.6" />
  </Svg>
);
export const IconLibrary = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M9 18V6.2l10-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="16.5" cy="16" r="2.5" />
  </Svg>
);
export const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="10.8" cy="10.8" r="6.3" />
    <path d="m20 20-4.7-4.7" />
  </Svg>
);
export const IconPerson = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="12" cy="8.2" r="3.7" />
    <path d="M4.8 20c.6-3.7 3.4-5.6 7.2-5.6s6.6 1.9 7.2 5.6" />
  </Svg>
);
export const IconPlay = (p: SVGProps<SVGSVGElement>) => (
  <Svg solid {...p}>
    <path d="M8 5.4v13.2a.9.9 0 0 0 1.38.76l10.2-6.6a.9.9 0 0 0 0-1.52L9.38 4.64A.9.9 0 0 0 8 5.4Z" />
  </Svg>
);
export const IconPause = (p: SVGProps<SVGSVGElement>) => (
  <Svg solid {...p}>
    <rect x="6.2" y="4.6" width="3.9" height="14.8" rx="1.2" />
    <rect x="13.9" y="4.6" width="3.9" height="14.8" rx="1.2" />
  </Svg>
);
export const IconNext = (p: SVGProps<SVGSVGElement>) => (
  <Svg solid {...p}>
    <path d="M5 6.1v11.8a.8.8 0 0 0 1.25.66l8.4-5.9a.8.8 0 0 0 0-1.32l-8.4-5.9A.8.8 0 0 0 5 6.1Z" />
    <rect x="16" y="5.2" width="3.2" height="13.6" rx="1.1" />
  </Svg>
);
export const IconPrev = (p: SVGProps<SVGSVGElement>) => (
  <Svg solid {...p}>
    <path d="M19 6.1v11.8a.8.8 0 0 1-1.25.66l-8.4-5.9a.8.8 0 0 1 0-1.32l8.4-5.9A.8.8 0 0 1 19 6.1Z" />
    <rect x="4.8" y="5.2" width="3.2" height="13.6" rx="1.1" />
  </Svg>
);
export const IconShuffle = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M3.5 7h3.2c1.5 0 2.6.6 3.4 1.8l3.8 5.4c.8 1.2 1.9 1.8 3.4 1.8h3.2" />
    <path d="M3.5 17h3.2c1.5 0 2.6-.6 3.4-1.8M13.9 8.8C14.7 7.6 15.8 7 17.3 7h3.2" />
    <path d="m18.2 4.7 2.3 2.3-2.3 2.3M18.2 14.7l2.3 2.3-2.3 2.3" />
  </Svg>
);
export const IconMix = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M3 14.5c2.4 0 2.6-5 5-5s2.6 5 5 5 2.6-5 5-5h3" />
    <path d="M3 9.5c2.4 0 2.6 5 5 5s2.6-5 5-5 2.6 5 5 5h3" opacity=".5" />
  </Svg>
);
export const IconRepeat = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 11V9.6A3.6 3.6 0 0 1 7.6 6H20" />
    <path d="m17 3 3 3-3 3" />
    <path d="M20 13v1.4a3.6 3.6 0 0 1-3.6 3.6H4" />
    <path d="m7 21-3-3 3-3" />
  </Svg>
);
export const IconRepeatOne = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 11V9.6A3.6 3.6 0 0 1 7.6 6H20" />
    <path d="m17 3 3 3-3 3" />
    <path d="M20 13v1.4a3.6 3.6 0 0 1-3.6 3.6H4" />
    <path d="m7 21-3-3 3-3" />
    <path d="M11.2 10.8 12.6 10v5" />
  </Svg>
);
export const IconVolumeLow = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4.5 9.7v4.6h3.3l4.2 3.7V6L7.8 9.7H4.5Z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconVolumeHigh = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M3 9.7v4.6h3.3l4.2 3.7V6L6.3 9.7H3Z" fill="currentColor" stroke="none" />
    <path d="M14.3 9.2a4 4 0 0 1 0 5.6M16.9 6.6a7.7 7.7 0 0 1 0 10.8" />
  </Svg>
);
export const IconChevronDown = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </Svg>
);
export const IconChevronBack = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />
  </Svg>
);
export const IconChevronForward = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />
  </Svg>
);
export const IconPlus = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
export const IconCalendar = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="3" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </Svg>
);
export const IconJingle = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
  </Svg>
);
export const IconUpNext = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 7h11M4 12h11M4 17h6" />
    <path d="m17.5 14.5 3 2.5-3 2.5Z" fill="currentColor" stroke="none" />
  </Svg>
);
export const IconSwap = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M7 4 3.5 7.5 7 11M3.5 7.5h13M17 13l3.5 3.5L17 20M20.5 16.5h-13" />
  </Svg>
);
export const IconWifiOff = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M3.5 9.2a14 14 0 0 1 4-2.3M20.5 9.2a14 14 0 0 0-8.5-3.4M6.6 12.7a9 9 0 0 1 2.7-1.8M17.4 12.7a9 9 0 0 0-4-2" />
    <path d="M9.7 16.2a4.4 4.4 0 0 1 4.6 0" />
    <circle cx="12" cy="19.2" r=".9" fill="currentColor" stroke="none" />
    <path d="m4 4 16 16" />
  </Svg>
);
export const IconGlobe = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z" />
  </Svg>
);
export const IconInstall = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 3.5v11M7.8 10.8 12 15l4.2-4.2" />
    <path d="M5 15.5V18a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2.5" />
  </Svg>
);
export const IconSignOut = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M10 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h3" />
    <path d="M15 8l4 4-4 4M19 12H9.5" />
  </Svg>
);
/** the three dots of a row's menu (frameless; the hit area is the button around it) */
export const IconMore = (p: SVGProps<SVGSVGElement>) => (
  <Svg solid {...p}>
    <circle cx="5.5" cy="12" r="1.9" />
    <circle cx="12" cy="12" r="1.9" />
    <circle cx="18.5" cy="12" r="1.9" />
  </Svg>
);
export const IconLink = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
  </Svg>
);
/** identify a song — a sound wave */
export const IconIdentify = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
  </Svg>
);
/** the people of a branch — two heads */
export const IconPeople = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 5.8M17.5 14.7c2 .5 3.5 2.2 3.5 4.8" />
  </Svg>
);
/** a pencil — change a name */
export const IconPencil = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M4.5 19.5l1-4.2L16.3 4.5a1.8 1.8 0 0 1 2.6 0l.6.6a1.8 1.8 0 0 1 0 2.6L8.7 18.5z" />
    <path d="M14.5 6.3l3.2 3.2" />
  </Svg>
);
/** a place — where a branch is */
export const IconPin = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.4" />
  </Svg>
);
/** a moon — a quiet block (no music) */
export const IconMoon = (p: SVGProps<SVGSVGElement>) => (
  <Svg {...p}>
    <path d="M20 14.2A8 8 0 0 1 9.8 4a8 8 0 1 0 10.2 10.2z" />
  </Svg>
);
