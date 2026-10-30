/**
 * Role permissions (owner 2026-10-31, the Discord-style Roles screen) — the pure catalog and rules. Run: node --env-file=.env.development --require ./scripts/_test-stubs/preload.cjs --import tsx scripts/verify-role-permissions.ts
 */
import * as rp from "../lib/role-permissions";
import { DEFAULT_ROLES } from "../lib/roles";

let pass = 0;
let fail = 0;
function assert(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `   -> ${JSON.stringify(detail)}`}`);
  if (ok) pass++;
  else fail++;
}

assert("R1 the catalog holds the owner's list: eight player permissions, four extras, the 'more settings' switch and its four sub-switches", rp.PLAYER_PERMISSIONS.length === 8 && ["play_pause", "skip", "queue_add", "playlist_create", "schedule", "volume", "seek", "stop_player"].every((k) => (rp.PLAYER_PERMISSIONS as readonly string[]).includes(k)) && rp.MORE_SETTINGS_PERMISSIONS.length === 4 && ["edit_people", "edit_players", "add_people", "remove_people"].every((k) => (rp.MORE_SETTINGS_PERMISSIONS as readonly string[]).includes(k)) && rp.ALL_FLAG_KEYS.includes("more_settings") && rp.EXTRA_PERMISSIONS.includes("branch_settings"));
assert("R2 every key the screen shows has a title and a hint, and the groups cover every flag exactly once", rp.ALL_FLAG_KEYS.every((k) => !!rp.PERMISSION_LABELS[k]?.title && !!rp.PERMISSION_LABELS[k]?.hint) && (() => { const shown = rp.PERMISSION_GROUPS.flatMap((g) => g.keys).filter((k) => k !== "openControlRoom" && k !== "allowComputer"); return shown.length === rp.ALL_FLAG_KEYS.length && new Set(shown).size === shown.length; })());
const empty = rp.emptyPermissions();
assert("R3 a role the owner makes starts with nothing allowed, all players visible, no people visible, and a look of its own", Object.values(empty.flags).every((v) => v === false) && empty.players.mode === "ALL" && empty.people.mode === "NONE" && !!empty.appearance.shape);
const mgr = rp.defaultPermissionsFor("Manager");
const emp = rp.defaultPermissionsFor("Employee");
assert("R4 the ready-made roles have sensible defaults: Manager everything, Employee only play / skip / volume, a custom name nothing", rp.ALL_FLAG_KEYS.every((k) => mgr.flags[k]) && mgr.people.mode === "ALL" && emp.flags.play_pause && emp.flags.skip && emp.flags.volume && !emp.flags.stop_player && !emp.flags.more_settings && JSON.stringify(rp.defaultPermissionsFor("Whatever").flags) === JSON.stringify(empty.flags));
assert("R5 an EMPTY stored object reads as the defaults of the role's name (roles made before this screen keep a sensible list)", JSON.stringify(rp.normalizePermissions({}, "Manager")) === JSON.stringify(mgr) && JSON.stringify(rp.normalizePermissions(null, "Employee")) === JSON.stringify(emp));
const messy = rp.normalizePermissions({ flags: { play_pause: true, volume: "yes", hacker: true, more_settings: false, add_people: true }, players: { mode: "SOME", ids: ["b1", "b1", 7, "", "b2"] }, people: { mode: "BOGUS", ids: ["x"] } }, "Custom");
assert("R6 normalising drops unknown keys, only a real `true` turns a flag on, sub-switches are off while 'more settings' is off, scope ids are unique strings and a bad mode falls back", messy.flags.play_pause === true && messy.flags.volume === false && !("hacker" in messy.flags) && messy.flags.add_people === false && messy.players.mode === "SOME" && messy.players.ids.join() === "b1,b2" && messy.people.mode === "NONE" && messy.people.ids.length === 0);
const some = rp.normalizePermissions({ flags: { more_settings: true, add_people: true }, players: { mode: "ALL", ids: ["b1"] } }, "Custom");
assert("R7 'more settings' on keeps its sub-switches; ids only count for SOME", some.flags.more_settings && some.flags.add_people && some.players.mode === "ALL" && some.players.ids.length === 0);
const big = rp.normalizePermissions({ flags: {}, players: { mode: "SOME", ids: Array.from({ length: 500 }, (_, i) => `b${i}`) } }, "Custom");
assert("R8 a scope never holds more than the limit of ids", big.players.ids.length === rp.MAX_SCOPE_IDS);
assert("R9 the API accepts an object (or nothing) and refuses a list / text", rp.validatePermissionsInput(undefined).ok && rp.validatePermissionsInput({ flags: {} }).ok && !rp.validatePermissionsInput([]).ok && !rp.validatePermissionsInput("x").ok);
assert("R10 the ready-made roles still keep 'may sign in from a computer' OFF (owner 2026-10-31)", DEFAULT_ROLES.every((r) => r.allowComputer === false));

assert("R11 roles have a SHAPE and a colour (owner 2026-10-31): the ready-made ones have their own (crown / shield / star), others a stable one from their name; a stored valid look is kept, an invalid one falls back", rp.defaultAppearance("Manager").shape === "crown" && rp.defaultAppearance("Shift manager").shape === "shield" && rp.defaultAppearance("Employee").shape === "star" && JSON.stringify(rp.defaultAppearance("Night cashier")) === JSON.stringify(rp.defaultAppearance("Night cashier")) && rp.normalizePermissions({ flags: {}, appearance: { shape: "flame", color: "#ff8a8a" } }, "X").appearance.shape === "flame" && rp.normalizePermissions({ flags: {}, appearance: { shape: "bogus", color: "red" } }, "Manager").appearance.shape === "crown" && rp.ROLE_SHAPES.length >= 10 && rp.ROLE_COLORS.length >= 6);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
