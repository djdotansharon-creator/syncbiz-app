import type { RadioStream } from "./source-types";
import type { UnifiedSource } from "./source-types";

const DEFAULT_RADIO_IMAGE = "/radio-default.svg";

export function radioToUnified(r: RadioStream): UnifiedSource {
  return {
    id: r.id,
    title: r.name,
    genre: r.genre || "Radio",
    cover: r.cover || DEFAULT_RADIO_IMAGE,
    type: "stream-url",
    url: r.url,
    origin: "radio",
    radio: r,
  };
}
