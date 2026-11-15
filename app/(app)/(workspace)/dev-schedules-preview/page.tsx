"use client";

/**
 * LOCAL-ONLY preview (NOT part of any PR — keep untracked): the Schedules Studio with a made-up network of four branches (like the mock-up the owner showed),
 * so the day view's branch rows can be seen. Saving does nothing useful here (it calls the real /api/schedules); this page is for looking only.
 */
import { SchedulesStudio } from "@/components/schedules-studio/schedules-studio";
import type { Playlist } from "@/lib/playlist-types";
import type { Schedule } from "@/lib/types";

const svg = (a: string, b: string, glyph: string) =>
  `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='${a}'/><stop offset='1' stop-color='${b}'/></linearGradient></defs><rect width='96' height='96' rx='12' fill='url(#g)'/><circle cx='48' cy='54' r='20' fill='rgba(255,255,255,.35)'/><text x='48' y='60' font-size='22' text-anchor='middle' fill='white'>${glyph}</text></svg>`)}`;

const P = (id: string, name: string, cover: string, branchId: string) => ({ id, name, thumbnail: cover, cover, branchId, tracks: [{}, {}, {}] }) as unknown as Playlist;
const playlists: Playlist[] = [
  P("p1", "בוקר רגוע", svg("#f4b183", "#fde9d9", "☀"), "b1"),
  P("p2", "Velvet Nights", svg("#5b3fd4", "#c07cf0", "♪"), "b1"),
  P("p3", "ערב שישי", svg("#d9482b", "#f6a04a", "◐"), "b1"),
  P("p4", "להיטי קיץ", svg("#ff9a44", "#ffd26f", "☼"), "b2"),
  P("p5", "ערב בחנות", svg("#e0661f", "#f7b267", "◗"), "b2"),
  P("p6", "ג'אז לערב", svg("#14463e", "#2f8f78", "♫"), "b3"),
  P("p7", "שקט", svg("#1d3f8f", "#4a7be0", "≈"), "b3"),
  P("p8", "ג'אז צהריים", svg("#1f5a4c", "#43a08a", "♬"), "b4"),
  P("p9", "ערב שישי ב", svg("#4b2fc0", "#9d6cf0", "✦"), "b4"),
];
const S = (id: string, branchId: string, targetId: string, start: string, days: number[]) =>
  ({ id, accountId: "a", name: id, branchId, targetType: "PLAYLIST", targetId, daysOfWeek: days, startTimeLocal: start, endTimeLocal: "23:59", enabled: true, priority: 1, recurrence: "weekly" }) as Schedule;
const all = [0, 1, 2, 3, 4, 5, 6];
const schedules: Schedule[] = [
  S("s1", "b1", "p1", "09:00:00", all), S("s2", "b1", "p2", "15:00:00", all), S("s3", "b1", "p3", "19:00:00", all),
  S("s4", "b2", "p4", "09:30:00", all), S("s5", "b2", "p5", "20:00:00", all),
  S("s6", "b3", "p1", "09:00:00", all), S("s7", "b3", "p7", "13:00:00", all), S("s8", "b3", "p6", "19:00:00", all),
  S("s9", "b4", "p8", "11:30:00", all), S("s10", "b4", "p9", "17:00:00", all),
];
const branches = [{ id: "b1", name: "שרונה" }, { id: "b2", name: "דיזנגוף" }, { id: "b3", name: "רוטשילד" }, { id: "b4", name: "יפו" }];

export default function DevSchedulesPreview() {
  return <SchedulesStudio initialSchedules={schedules} playlists={playlists} sources={[]} radioStations={[]} devices={[]} branches={branches} />;
}
