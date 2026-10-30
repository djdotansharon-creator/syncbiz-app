/**
 * What a ROLE may do — the permission list of the Discord-style Roles screen (owner 2026-10-31; docs/ROLES_DESIGN.md). Pure (no database, no React) so the screen, the API and the tests share ONE definition.
 *
 * Two switches live in their own columns since the first roles release (`openControlRoom`, `allowComputer`); everything else is the `permissions` JSON of the role:
 *   flags   — one on/off per permission below
 *   players — which players (branches) the role can see / control: ALL, NONE or SOME (+ the ids)
 *   people  — which people the role can see: ALL, NONE or SOME (+ the ids)
 * An empty `permissions` ({}), as on every role made before this screen, reads as the ready-made defaults of that role's name (Manager / Shift manager / Employee) or "nothing" for a custom role.
 * ENFORCEMENT: this file only DEFINES and VALIDATES. Where each permission is enforced is listed in docs/ROLES_DESIGN.md ("Enforcement map") — stage by stage, and never claimed here.
 */

export const PLAYER_PERMISSIONS = ["play_pause", "skip", "queue_add", "playlist_create", "schedule", "volume", "seek", "stop_player"] as const;
export const EXTRA_PERMISSIONS = ["announcements", "library_manage", "dashboard", "branch_settings"] as const;
/** only meaningful while "more_settings" is on */
export const MORE_SETTINGS_PERMISSIONS = ["edit_people", "edit_players", "add_people", "remove_people"] as const;

export type PlayerPermission = (typeof PLAYER_PERMISSIONS)[number];
export type ExtraPermission = (typeof EXTRA_PERMISSIONS)[number];
export type MoreSettingsPermission = (typeof MORE_SETTINGS_PERMISSIONS)[number];
export type PermissionKey = PlayerPermission | ExtraPermission | MoreSettingsPermission | "more_settings";

export const ALL_FLAG_KEYS: readonly PermissionKey[] = [...PLAYER_PERMISSIONS, ...EXTRA_PERMISSIONS, "more_settings", ...MORE_SETTINGS_PERMISSIONS];

export type ScopeMode = "ALL" | "NONE" | "SOME";
export type Scope = { mode: ScopeMode; ids: string[] };
/** the look of a role: a SHAPE (not a plain dot) in a colour (owner 2026-10-31: "give shapes you can give to roles") */
export const ROLE_SHAPES = ["star", "diamond", "hexagon", "shield", "crown", "bolt", "heart", "flame", "moon", "flag", "gem", "circle"] as const;
export type RoleShape = (typeof ROLE_SHAPES)[number];
export const ROLE_COLORS = ["#5fe3a1", "#7db8ff", "#ffcf5c", "#ff8a8a", "#c79bff", "#5fd4e3", "#ffa86b", "#f5f5f7"] as const;
export type RoleAppearance = { shape: RoleShape; color: string };

export type RolePermissions = { flags: Record<PermissionKey, boolean>; players: Scope; people: Scope; appearance: RoleAppearance };

const nameHash = (name: string): number => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
};

/** a stable look for a role that has not been given one: the ready-made roles have their own, others follow their name */
export function defaultAppearance(roleName: string): RoleAppearance {
  if (roleName === "Manager") return { shape: "crown", color: "#ffcf5c" };
  if (roleName === "Shift manager") return { shape: "shield", color: "#7db8ff" };
  if (roleName === "Employee") return { shape: "star", color: "#5fe3a1" };
  const h = nameHash(roleName);
  return { shape: ROLE_SHAPES[h % (ROLE_SHAPES.length - 1)], color: ROLE_COLORS[(h >>> 3) % ROLE_COLORS.length] };
}

export const MAX_SCOPE_IDS = 200;

const none = (): Record<PermissionKey, boolean> => Object.fromEntries(ALL_FLAG_KEYS.map((k) => [k, false])) as Record<PermissionKey, boolean>;
const on = (keys: readonly PermissionKey[]): Record<PermissionKey, boolean> => ({ ...none(), ...Object.fromEntries(keys.map((k) => [k, true])) });

/** a role the owner makes himself starts with nothing allowed — he switches on what he wants */
export function emptyPermissions(roleName = ""): RolePermissions {
  return { flags: none(), players: { mode: "ALL", ids: [] }, people: { mode: "NONE", ids: [] }, appearance: defaultAppearance(roleName) };
}

const DEFAULTS_BY_NAME: Record<string, RolePermissions> = {
  Manager: { flags: on(ALL_FLAG_KEYS), players: { mode: "ALL", ids: [] }, people: { mode: "ALL", ids: [] }, appearance: defaultAppearance("Manager") },
  "Shift manager": { flags: on(["play_pause", "skip", "queue_add", "volume", "seek", "announcements"]), players: { mode: "ALL", ids: [] }, people: { mode: "NONE", ids: [] }, appearance: defaultAppearance("Shift manager") },
  Employee: { flags: on(["play_pause", "skip", "volume"]), players: { mode: "ALL", ids: [] }, people: { mode: "NONE", ids: [] }, appearance: defaultAppearance("Employee") },
};

export function defaultPermissionsFor(roleName: string): RolePermissions {
  const d = DEFAULTS_BY_NAME[roleName];
  return d ? { flags: { ...d.flags }, players: { ...d.players, ids: [...d.players.ids] }, people: { ...d.people, ids: [...d.people.ids] }, appearance: { ...d.appearance } } : emptyPermissions(roleName);
}

function normalizeScope(raw: unknown, fallback: Scope): Scope {
  if (!raw || typeof raw !== "object") return { mode: fallback.mode, ids: [...fallback.ids] };
  const r = raw as { mode?: unknown; ids?: unknown };
  const mode: ScopeMode = r.mode === "ALL" || r.mode === "SOME" || r.mode === "NONE" ? r.mode : fallback.mode;
  const ids = Array.isArray(r.ids) ? [...new Set(r.ids.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 100))].slice(0, MAX_SCOPE_IDS) : [];
  return { mode, ids: mode === "SOME" ? ids : [] };
}

/** Turns whatever is stored / sent into a complete, valid RolePermissions. Unknown keys are dropped, missing flags are off; an EMPTY object means "the defaults of this role's name". */
export function normalizePermissions(raw: unknown, roleName: string): RolePermissions {
  const isEmpty = !raw || typeof raw !== "object" || Object.keys(raw as object).length === 0;
  if (isEmpty) return defaultPermissionsFor(roleName);
  const r = raw as { flags?: unknown; players?: unknown; people?: unknown; appearance?: unknown };
  const flags = none();
  if (r.flags && typeof r.flags === "object") {
    for (const k of ALL_FLAG_KEYS) if ((r.flags as Record<string, unknown>)[k] === true) flags[k] = true;
  }
  // the sub-switches of "more settings" mean nothing while it is off — keep the stored value off so a later switch-on starts from a clear page
  if (!flags.more_settings) for (const k of MORE_SETTINGS_PERMISSIONS) flags[k] = false;
  const base = emptyPermissions(roleName);
  const ap = r.appearance && typeof r.appearance === "object" ? (r.appearance as { shape?: unknown; color?: unknown }) : {};
  const appearance: RoleAppearance = {
    shape: (ROLE_SHAPES as readonly string[]).includes(ap.shape as string) ? (ap.shape as RoleShape) : base.appearance.shape,
    color: (ROLE_COLORS as readonly string[]).includes(ap.color as string) ? (ap.color as string) : base.appearance.color,
  };
  return { flags, players: normalizeScope(r.players, base.players), people: normalizeScope(r.people, base.people), appearance };
}

/** a validation for the API: the body must be an object (flags / players / people); everything else is normalised, never rejected */
export function validatePermissionsInput(raw: unknown): { ok: true } | { ok: false; error: "permissions" } {
  if (raw === undefined) return { ok: true };
  return raw && typeof raw === "object" && !Array.isArray(raw) ? { ok: true } : { ok: false, error: "permissions" };
}

/** the groups the screen draws, in order (labels are English keys passed through tr() by the screen) */
export const PERMISSION_GROUPS: ReadonlyArray<{ id: "access" | "player" | "extra" | "more"; title: string; hint?: string; keys: ReadonlyArray<PermissionKey | "openControlRoom" | "allowComputer"> }> = [
  { id: "access", title: "Access", keys: ["openControlRoom", "allowComputer"] },
  { id: "player", title: "Player", hint: "What the person may do to the music of a player they can control.", keys: [...PLAYER_PERMISSIONS] },
  { id: "extra", title: "Library & business", keys: [...EXTRA_PERMISSIONS] },
  { id: "more", title: "More settings", hint: "Switch this on and the next ones open.", keys: ["more_settings", ...MORE_SETTINGS_PERMISSIONS] },
];

export const PERMISSION_LABELS: Record<PermissionKey | "openControlRoom" | "allowComputer", { title: string; hint: string }> = {
  openControlRoom: { title: "Opens the Control Room", hint: "The management screens: Control Room, Dashboard and Permissions." },
  allowComputer: { title: "May sign in from a computer", hint: "Off: only a phone. On: also a computer, as a remote control." },
  play_pause: { title: "Play and pause", hint: "Start and stop the music." },
  skip: { title: "Next and previous song", hint: "Move forward or back in the list." },
  queue_add: { title: "Add songs to the list", hint: "Put songs in the queue and in Play Next." },
  playlist_create: { title: "Create playlists", hint: "Make new playlists and change them." },
  schedule: { title: "Schedule songs", hint: "Send a song or a playlist to play at a set time." },
  volume: { title: "Volume", hint: "Raise and lower the sound." },
  seek: { title: "Time bar of the song", hint: "Jump to another point inside the song." },
  stop_player: { title: "Stop the player completely", hint: "Switch the player off, not only pause it." },
  announcements: { title: "Announcements and jingles", hint: "Record and play announcements over the music." },
  library_manage: { title: "Manage the library", hint: "Add and remove sources, radio stations and imports." },
  dashboard: { title: "See the dashboard", hint: "Reports and the state of the business." },
  branch_settings: { title: "Open a branch's settings", hint: "Off: the person can control a branch from afar but not open its settings." },
  more_settings: { title: "More settings", hint: "Opens the options below." },
  edit_people: { title: "Change a person's permissions and details", hint: "Give roles and edit what a person may do." },
  edit_players: { title: "Edit players", hint: "Rename, replace and set up the players the person can control." },
  add_people: { title: "Add people", hint: "Create join codes and approve people who ask to join." },
  remove_people: { title: "Remove people", hint: "Take a person out of the business." },
};
