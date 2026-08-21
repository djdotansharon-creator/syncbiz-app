import type { SamplerPadItem } from "./types";
import { SAMPLER_PADS } from "./seed-data";

/**
 * Shared Cloud Quick Pads client — the SINGLE data/actions layer used by BOTH the Desktop
 * JinglesShell and the Mobile Jingles screen (no parallel implementation). It talks to the shared
 * GET/POST /api/jingles/pads; workspace + branch scoping is enforced server-side from the session.
 */
export type CloudPad = {
  padId: string;
  label: string;
  url: string;
  color: string | null;
  bellStyle: string | null;
  preRoll: boolean;
};

export async function fetchCloudPads(): Promise<CloudPad[]> {
  const res = await fetch("/api/jingles/pads", { cache: "no-store" });
  if (!res.ok) throw new Error(`pads GET ${res.status}`);
  const data = (await res.json()) as { items?: CloudPad[] };
  return data.items ?? [];
}

export async function savePadToCloud(pad: SamplerPadItem): Promise<void> {
  const res = await fetch("/api/jingles/pads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      padId: pad.id,
      label: pad.label ?? "",
      url: pad.url ?? "",
      color: pad.color ?? null,
      bellStyle: pad.bellStyle ?? null,
      preRoll: pad.preRoll ?? false,
    }),
  });
  if (!res.ok) throw new Error(`pads POST ${res.status}`);
}

/** Render the 8 canonical pads = seed defaults with cloud overrides applied by padId. */
export function padsFromCloud(cloud: CloudPad[]): SamplerPadItem[] {
  const byId = new Map(cloud.map((c) => [c.padId, c]));
  return SAMPLER_PADS.map((seed) => {
    const c = byId.get(seed.id);
    if (!c) return { ...seed };
    return {
      ...seed,
      label: c.label || seed.label,
      url: c.url || "",
      color: (c.color as SamplerPadItem["color"]) ?? seed.color,
      bellStyle: (c.bellStyle as SamplerPadItem["bellStyle"]) ?? seed.bellStyle,
      preRoll: c.preRoll,
    };
  });
}
