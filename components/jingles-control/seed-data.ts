import type { MockHistoryEvent, MockLibraryItem, MockScheduleItem, SamplerPadItem } from "./types";

/** Static demo rows only — not persisted; does not interact with playback. */
export const INITIAL_MOCK_HISTORY: MockHistoryEvent[] = [
  {
    id: "seed-1",
    atIso: "2026-04-10T08:30:00.000Z",
    kind: "created",
    message: "Demo: draft created (mock)",
  },
  {
    id: "seed-2",
    atIso: "2026-04-10T08:31:00.000Z",
    kind: "previewed",
    message: "Demo: preview (mock — no audio)",
  },
  {
    id: "seed-3",
    atIso: "2026-04-10T08:32:00.000Z",
    kind: "saved",
    message: "Demo: saved to library (mock)",
  },
  {
    id: "seed-4",
    atIso: "2026-04-10T08:45:00.000Z",
    kind: "scheduled",
    message: "Demo: scheduled slot (mock)",
  },
  {
    id: "seed-5",
    atIso: "2026-04-10T09:00:00.000Z",
    kind: "failed",
    message: "Demo: generation failed — would retry later (mock)",
  },
  {
    id: "seed-6",
    atIso: "2026-04-10T09:05:00.000Z",
    kind: "restored",
    message: "Demo: session restored after interrupt (mock)",
  },
];

export const MOCK_LIBRARY_ITEMS: MockLibraryItem[] = [
  {
    id: "lib-1",
    title: "Weekend promo — electronics",
    tags: ["promo", "retail"],
    kind: "jingle",
    durationLabel: "0:22",
    favorite: true,
  },
  {
    id: "lib-2",
    title: "Store closing in 15 minutes",
    tags: ["closing", "reminder"],
    kind: "announcement",
    durationLabel: "0:18",
    favorite: false,
  },
  {
    id: "lib-3",
    title: "Birthday shout-out template",
    tags: ["birthday", "personal"],
    kind: "broadcast",
    durationLabel: "0:35",
    favorite: true,
  },
];

export const MOCK_SCHEDULE_ITEMS: MockScheduleItem[] = [
  {
    id: "sch-1",
    label: "Fresh bread — morning",
    whenLabel: "Tomorrow 08:00",
    repeatLabel: "Daily",
    targetLabel: "This branch (mock)",
  },
  {
    id: "sch-2",
    label: "Weekend sale teaser",
    whenLabel: "Fri 17:30",
    repeatLabel: "Weekly",
    targetLabel: "This branch (mock)",
  },
];

export const SAMPLER_PADS: SamplerPadItem[] = [
  { id: "pad-promo", label: "Promo", url: "" },
  { id: "pad-closing", label: "Closing Soon", url: "" },
  { id: "pad-birthday", label: "Birthday", url: "" },
  { id: "pad-bread", label: "Fresh Bread", url: "" },
  { id: "pad-meat", label: "Meat Sale", url: "" },
  { id: "pad-store", label: "Store Message", url: "" },
  { id: "pad-weekend", label: "Weekend Sale", url: "" },
  { id: "pad-custom", label: "Custom", url: "" },
];

export const MOCK_AI_SUGGESTIONS = [
  "Attention shoppers: fresh bakery items are available at the front of the store. Thank you for shopping with us today.",
  "Friendly reminder: our weekend promotion ends Sunday night. Ask a team member for details.",
  "We will be closing in approximately fifteen minutes. Please bring your final purchases to the registers.",
] as const;
