/**
 * Cinematic hero art for each Royalty-Free Music Genre Pack (presentation only — no playback/data).
 *
 * Every pack gets a bespoke colour grade + a thematic silhouette motif (per the catalog owner's art
 * direction), rendered with one consistent cinematic language: gradient base → thematic SVG motif →
 * stage-light spotlight → bottom scrim (text legibility) → film grain. Built from CSS + inline SVG so
 * it stays local, needs no image assets/credits, and carries no licensing. A photographic cover can
 * later replace the motif layer in the same slot.
 */

type MotifKey = "beams" | "skyline" | "vinyl" | "piano" | "sunset" | "guitar" | "mic";
export type GenreArt = { from: string; via: string; to: string; accent: string; motif: MotifKey };

const NOISE =
  "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='140' height='140'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")";

/** Per-pack colour grade + motif. Keyed by catalog genre id. */
export const GENRE_ART: Record<string, GenreArt> = {
  "dance": { from: "#1c0a2e", via: "#6a1f5a", to: "#ff6a3d", accent: "#ff8ac0", motif: "beams" },
  "deep-house": { from: "#0a1622", via: "#123043", to: "#2f6f8a", accent: "#7fd4ff", motif: "skyline" },
  "funk-groove": { from: "#241206", via: "#6a3a12", to: "#e0912f", accent: "#ffc766", motif: "vinyl" },
  "jazz": { from: "#140e28", via: "#3a2a52", to: "#b98a44", accent: "#ffd98a", motif: "piano" },
  "lounge-and-chillout": { from: "#16233f", via: "#b0506a", to: "#ff9e5a", accent: "#ffd0a0", motif: "sunset" },
  "soft-pop-and-rock": { from: "#101f30", via: "#3a5570", to: "#d99a58", accent: "#ffd08a", motif: "guitar" },
  "soul-and-rnb": { from: "#200a24", via: "#6a1740", to: "#b23a52", accent: "#ff9ab0", motif: "mic" },
};

export const DEFAULT_ART: GenreArt = { from: "#141420", via: "#2a2a3a", to: "#5a5a72", accent: "#9ab0ff", motif: "beams" };

export function genreArt(id: string): GenreArt {
  return GENRE_ART[id] ?? DEFAULT_ART;
}

function Motif({ motif, accent }: { motif: MotifKey; accent: string }) {
  switch (motif) {
    case "beams":
      return (
        <g>
          <g fill="#fff" opacity="0.14">
            <polygon points="205,-30 120,250 150,250" />
            <polygon points="205,-30 168,250 186,250" />
            <polygon points="205,-30 214,250 232,250" />
            <polygon points="205,-30 252,250 284,250" />
          </g>
          <g fill={accent} opacity="0.55">
            {[150, 166, 182, 198, 214, 230, 246].map((x, i) => {
              const h = [30, 52, 36, 66, 40, 56, 30][i];
              return <rect key={x} x={x} y={235 - h} width="10" height={h} rx="2" />;
            })}
          </g>
        </g>
      );
    case "skyline":
      return (
        <g>
          <circle cx="322" cy="58" r="26" fill="#fff" opacity="0.22" />
          <circle cx="322" cy="58" r="26" fill="none" stroke={accent} strokeOpacity="0.25" strokeWidth="1" />
          <g fill="#000" opacity="0.32">
            <rect x="150" y="150" width="30" height="100" />
            <rect x="185" y="120" width="26" height="130" />
            <rect x="215" y="165" width="22" height="85" />
            <rect x="242" y="135" width="30" height="115" />
            <rect x="278" y="162" width="24" height="88" />
            <rect x="306" y="108" width="34" height="142" />
            <rect x="345" y="150" width="26" height="100" />
          </g>
          <g fill={accent} opacity="0.6">
            {[[192, 135], [192, 150], [252, 152], [252, 170], [314, 128], [314, 150], [314, 172], [356, 168]].map(([x, y], i) => (
              <rect key={i} x={x} y={y} width="5" height="7" />
            ))}
          </g>
        </g>
      );
    case "vinyl":
      return (
        <g transform="translate(292,120)">
          <circle r="88" fill="#000" opacity="0.30" />
          <circle r="88" fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" />
          <circle r="70" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1" />
          <circle r="52" fill="none" stroke="#fff" strokeOpacity="0.12" strokeWidth="1" />
          <circle r="30" fill={accent} opacity="0.5" />
          <circle r="7" fill="#000" opacity="0.6" />
          <line x1="66" y1="-104" x2="14" y2="-16" stroke="#fff" strokeOpacity="0.35" strokeWidth="4" strokeLinecap="round" />
        </g>
      );
    case "piano":
      return (
        <g transform="translate(206,150) rotate(-8)">
          <rect x="0" y="0" width="196" height="50" rx="5" fill="#000" opacity="0.30" />
          <g stroke="#fff" strokeOpacity="0.18" strokeWidth="1">
            {[24, 48, 72, 96, 120, 144, 168].map((x) => <line key={x} x1={x} y1="0" x2={x} y2="50" />)}
          </g>
          <g fill="#000" opacity="0.55">
            {[16, 40, 88, 112, 136, 184].map((x) => <rect key={x} x={x} y="0" width="9" height="30" rx="1" />)}
          </g>
          <rect x="0" y="0" width="196" height="50" rx="5" fill="none" stroke={accent} strokeOpacity="0.3" strokeWidth="1" />
        </g>
      );
    case "sunset":
      return (
        <g>
          <circle cx="205" cy="150" r="60" fill={accent} opacity="0.55" />
          <circle cx="205" cy="150" r="60" fill="none" stroke="#fff" strokeOpacity="0.15" strokeWidth="1" />
          <rect x="0" y="150" width="400" height="120" fill="#000" opacity="0.20" />
          <g stroke="#fff" strokeOpacity="0.16" strokeWidth="1">
            <line x1="120" y1="150" x2="300" y2="150" />
            <line x1="150" y1="176" x2="280" y2="176" />
            <line x1="176" y1="200" x2="256" y2="200" />
          </g>
          <g stroke="#000" strokeOpacity="0.34" strokeWidth="6" fill="none" strokeLinecap="round" transform="translate(64,152)">
            <path d="M0,0 C-6,-42 -4,-84 8,-116" />
            <g transform="translate(8,-116)">
              <path d="M0,0 C-32,-6 -58,6 -74,22" />
              <path d="M0,0 C-12,-26 -6,-52 8,-68" />
              <path d="M0,0 C26,-16 54,-14 74,0" />
              <path d="M0,0 C18,12 42,22 58,44" />
            </g>
          </g>
        </g>
      );
    case "guitar":
      return (
        <g transform="translate(244,34) rotate(26)" opacity="0.9">
          <ellipse cx="60" cy="156" rx="54" ry="64" fill="#000" opacity="0.30" />
          <ellipse cx="60" cy="156" rx="54" ry="64" fill="none" stroke={accent} strokeOpacity="0.25" strokeWidth="1.5" />
          <circle cx="60" cy="150" r="17" fill={accent} opacity="0.5" />
          <rect x="52" y="4" width="16" height="118" rx="4" fill="#000" opacity="0.30" />
          <rect x="45" y="-18" width="30" height="26" rx="4" fill="#000" opacity="0.30" />
          <g stroke="#fff" strokeOpacity="0.16" strokeWidth="1">
            {[56, 60, 64].map((x) => <line key={x} x1={x} y1="20" x2={x} y2="150" />)}
          </g>
        </g>
      );
    case "mic":
      return (
        <g>
          <g stroke={accent} strokeOpacity="0.22" strokeWidth="2">
            <line x1="300" y1="-10" x2="232" y2="250" />
            <line x1="344" y1="-10" x2="300" y2="250" />
            <line x1="388" y1="-10" x2="372" y2="250" />
          </g>
          <g transform="translate(300,64)">
            <rect x="-18" y="0" width="36" height="76" rx="18" fill="#000" opacity="0.34" />
            <g stroke="#fff" strokeOpacity="0.2" strokeWidth="2">
              {[16, 28, 40, 52].map((y) => <line key={y} x1="-15" y1={y} x2="15" y2={y} />)}
            </g>
            <rect x="-18" y="0" width="36" height="76" rx="18" fill="none" stroke={accent} strokeOpacity="0.35" strokeWidth="1.5" />
            <rect x="-4" y="76" width="8" height="86" fill="#000" opacity="0.34" />
            <ellipse cx="0" cy="164" rx="34" ry="9" fill="#000" opacity="0.34" />
          </g>
        </g>
      );
    default:
      return null;
  }
}

/** Packs that ship a photographic cover under /public/music-bank/covers/<id>.webp. */
const PHOTO_COVERS = new Set(Object.keys(GENRE_ART));

/**
 * Full cinematic cover for a Genre Pack. Fills its (relative/absolute) parent.
 * Primary: a premium photographic hero image graded dark for white-text overlay. The pack's colour
 * grade is kept as a subtle brand tint over the photo so the 7 covers still read as one family, and
 * the bottom scrim + grain preserve legibility. Falls back to the SVG motif for any pack without a
 * photo (unknown id / new pack).
 */
export function GenrePackArt({ id }: { id: string }) {
  const a = genreArt(id);
  const hasPhoto = PHOTO_COVERS.has(id);
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      {hasPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element -- pre-optimized static WebP; no runtime optimizer needed
        <img src={`/music-bank/covers/${id}.webp`} alt="" className="absolute inset-0 h-full w-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <>
          <div className="absolute inset-0" style={{ backgroundImage: `linear-gradient(140deg, ${a.from} 0%, ${a.via} 52%, ${a.to} 100%)` }} />
          <svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 h-full w-full">
            <Motif motif={a.motif} accent={a.accent} />
          </svg>
          <div className="absolute inset-0" style={{ background: "radial-gradient(120% 85% at 80% 6%, rgba(255,255,255,0.26), rgba(255,255,255,0) 55%)" }} />
        </>
      )}
      {hasPhoto ? (
        <div className="absolute inset-0 opacity-30 mix-blend-soft-light" style={{ background: `linear-gradient(150deg, ${a.from} 0%, transparent 58%)` }} />
      ) : null}
      <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.78) 0%, rgba(0,0,0,0.30) 42%, rgba(0,0,0,0) 70%)" }} />
      <div className="absolute inset-0 opacity-[0.07] mix-blend-overlay" style={{ backgroundImage: NOISE }} />
    </div>
  );
}
