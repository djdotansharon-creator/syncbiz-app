/** The shape of a role (a star, a crown, a shield…) in the role's colour — drawn with plain SVG paths, no image files. */
import type { ReactElement } from "react";
import type { RoleAppearance, RoleShape as ShapeId } from "@/lib/role-permissions";

const PATHS: Record<ShapeId, string> = {
  star: "M12 2.6l2.85 6 6.55.8-4.8 4.55 1.25 6.5L12 17.2 6.15 20.45l1.25-6.5L2.6 9.4l6.55-.8z",
  diamond: "M12 2l9 10-9 10-9-10z",
  hexagon: "M12 2l8.66 5v10L12 22l-8.66-5V7z",
  shield: "M12 2.4l8 3v6.3c0 4.6-3.2 8-8 9.9-4.8-1.9-8-5.3-8-9.9V5.4z",
  crown: "M3 8.2l4.6 4.1L12 4.5l4.4 7.8L21 8.2 19.2 19H4.8z",
  bolt: "M13.6 2L5.2 13.4h5.6L9.6 22l9.2-12.2h-5.7z",
  heart: "M12 20.8s-8.2-5.1-8.2-11A4.7 4.7 0 0 1 12 6.6a4.7 4.7 0 0 1 8.2 3.2c0 5.9-8.2 11-8.2 11z",
  flame: "M12 2.2c.6 3.7-3.6 5.2-3.6 9.2a3.6 3.6 0 0 0 7.2 0c0-1.1-.4-2-.9-2.7 2.6 1.4 4.4 3.9 4.4 6.7A7.1 7.1 0 0 1 5 15.4C5 10 10.6 8.9 12 2.2z",
  moon: "M20.2 14.6A8.6 8.6 0 0 1 9.4 3.8a8.6 8.6 0 1 0 10.8 10.8z",
  flag: "M5 3h2.2v18H5zM8.2 4.2h11.2l-2.8 4 2.8 4H8.2z",
  gem: "M6.2 3h11.6L22 9.2 12 21.2 2 9.2z",
  circle: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z",
};

export function RoleShapeIcon({ look, size = 18 }: { look: RoleAppearance; size?: number }): ReactElement {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className="sb-rs" style={{ color: look.color, flex: "none" }}>
      <path d={PATHS[look.shape] ?? PATHS.circle} fill="currentColor" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  );
}
