import type { ReactElement } from "react";
import type { DesignIcon } from "@/lib/kiosk-design";

const ICON = { width: "1.45em", height: "1.45em", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

/** The icons of the display screen's side panel (shared by the screen itself and the lock-screen design page, so they always look the same). */
export function KioskTabIcon({ id }: { id: DesignIcon }): ReactElement {
  switch (id) {
    case "next":
      return (<svg {...ICON}><path d="M4 6.5h11M4 12h8M4 17.5h6" /><path d="m16 13.5 5 3-5 3z" fill="currentColor" /></svg>);
    case "search":
      return (<svg {...ICON}><circle cx="11" cy="11" r="6.5" /><path d="m16.5 16.5 4 4" /></svg>);
    case "lists":
      return (<svg {...ICON}><path d="M12 4 3 8.5 12 13l9-4.5L12 4Z" /><path d="m3 12.5 9 4.5 9-4.5M3 16.5l9 4.5 9-4.5" /></svg>);
    case "jingles":
      return (<svg {...ICON}><path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z" /><path d="M10 21h4" /></svg>);
    case "day":
      return (<svg {...ICON}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>);
  }
}
