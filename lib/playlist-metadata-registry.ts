/**
 * Playlist classification vocabulary: stable `value` keys persisted in playlist JSON; `label` is UI-only.
 * Add rows here (e.g. { value: "israeli", label: "Israeli" }) to extend — no schema change required beyond this list.
 * Keep `value` as lowercase English slugs for storage and API validation.
 */

export const playlistMetadataRegistry = {
  useCases: [
    { value: "retail", label: "Retail" },
    { value: "restaurant", label: "Restaurant" },
    { value: "cafe", label: "Café" },
    { value: "gym", label: "Gym & workout" },
    { value: "office", label: "Office" },
    { value: "lounge", label: "Lounge" },
    { value: "event", label: "Event" },
    { value: "wedding", label: "Wedding" },
    { value: "weekend", label: "Weekend" },
    { value: "warmup", label: "Warm-up" },
    { value: "peak", label: "Peak hours" },
    { value: "closing", label: "Closing" },
  ] as const,

  primaryGenres: [
    { value: "house", label: "House" },
    { value: "techno", label: "Techno" },
    { value: "pop", label: "Pop" },
    { value: "rock", label: "Rock" },
    { value: "disco", label: "Disco" },
    { value: "afro", label: "Afro" },
    { value: "electronic", label: "Electronic" },
    { value: "hiphop", label: "Hip-hop" },
    { value: "latin", label: "Latin" },
    { value: "oriental", label: "Middle Eastern & oriental" },
  ] as const,

  subGenres: [
    { value: "progressive-house", label: "Progressive house" },
    { value: "afro-house", label: "Afro house" },
    { value: "melodic-techno", label: "Melodic techno" },
    { value: "organic-house", label: "Organic house" },
    { value: "tropical-house", label: "Tropical house" },
    { value: "slow-disco", label: "Slow disco" },
    { value: "soft-pop", label: "Soft pop" },
    { value: "hard-rock", label: "Hard rock" },
    { value: "indie-pop", label: "Indie pop" },
    { value: "electro-afro", label: "Electro afro" },
  ] as const,

  moods: [
    { value: "chill", label: "Chill" },
    { value: "uplifting", label: "Uplifting" },
    { value: "emotional", label: "Emotional" },
    { value: "warm", label: "Warm" },
    { value: "dark", label: "Dark" },
    { value: "sexy", label: "Sensual" },
    { value: "elegant", label: "Elegant" },
    { value: "happy", label: "Happy" },
    { value: "dramatic", label: "Dramatic" },
    { value: "spiritual", label: "Spiritual" },
  ] as const,

  energyLevels: [
    { value: "low", label: "Low" },
    { value: "medium", label: "Medium" },
    { value: "high", label: "High" },
  ] as const,
} as const;

export type MetadataUseCaseValue = (typeof playlistMetadataRegistry.useCases)[number]["value"];
export type MetadataPrimaryGenreValue = (typeof playlistMetadataRegistry.primaryGenres)[number]["value"];
export type MetadataSubGenreValue = (typeof playlistMetadataRegistry.subGenres)[number]["value"];
export type MetadataMoodValue = (typeof playlistMetadataRegistry.moods)[number]["value"];
export type MetadataEnergyLevelValue = (typeof playlistMetadataRegistry.energyLevels)[number]["value"];
