"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { applyControlRoomFilters, type StatusFilter } from "@/lib/control-room-filters";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";
import type { BranchSummary, StationPlaybackState } from "@/lib/remote-control/types";
import { StatusGlyph, StatusLed, STATUS_KEY, type MapDotStatus } from "@/components/control-room/branch-map";
import { NetworkMap } from "@/components/control-room/network-map";
import { BranchPanel } from "@/components/control-room/branch-panel";
import { BroadcastPanel } from "@/components/control-room/broadcast-panel";
import { BranchForm } from "@/components/control-room/branch-form";
import { NetworkCode } from "@/components/control-room/network-code";
import { BrandManager, BrandBadge, DEFAULT_BRAND_COLOR, type BrandRow } from "@/components/control-room/brand-manager";
import { FilterTab, RegionChip, Stat } from "@/components/management/primitives";
import { BranchJingles, JinglesHqPanel } from "@/components/control-room/jingles-panels";
import { suggestAudience, type AudienceDeps } from "@/components/control-room/jingle-audience";
import { REGIONS, branchRegion, type RegionId } from "@/lib/control-room-regions";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import type { Mgmt, MgmtKey } from "@/lib/i18n/management";

type BrandsData = { brands: BrandRow[]; defaultBrandId: string; branchBrand: Record<string, string> };

/**
 * CONTROL ROOM — all branches in one place: counters, a map of the network and the branch list (read-only view).
 *
 * Branch list = the workspace's branches from the database (`GET /api/branches`, incl. `hasStation`). Live status = the
 * existing owner_global WebSocket (`useRemoteOwner`): ONLINE when the branch's station (MASTER) is connected, PLAYING
 * from its last STATE_UPDATE. A branch with no registered station is "Needs installation" (never "Offline"). This view
 * never sends a playback command and never registers as a player.
 */

type DbBranch = {
  id: string;
  name: string;
  code?: string;
  city?: string;
  country?: string;
  status?: string;
  locationCode?: string | null;
  hasStation?: boolean;
  formattedAddress?: string | null;
  googlePlaceId?: string | null;
  street?: string;
  houseNumber?: string;
  latitude?: number | null;
  longitude?: number | null;
};

type Row = {
  id: string;
  name: string;
  /** customer branch number (locationCode) — secondary but clear */
  branchNumber: string | null;
  city: string;
  country: string;
  formattedAddress: string | null;
  googlePlaceId: string | null;
  street: string;
  houseNumber: string;
  latitude: number | null;
  longitude: number | null;
  hasStation: boolean;
  online: boolean;
  live: BranchSummary | null;
  state: StationPlaybackState | null;
  /** brand of the branch — the default Brand when unassigned (null only while brands are unavailable) */
  brandId: string | null;
  /** operational region from the stored lat/lng (null: no location / outside Israel — never hidden from All Israel) */
  regionId: RegionId | null;
  regionReason: "ok" | "no_location" | "outside";
};


type RowStatus = MapDotStatus;

/** map size (owner 2026-10-12): the map's share of the width + its height; remembered per viewer */
type MapSize = "compact" | "balanced" | "focus";
const MAP_SIZES: { id: MapSize; label: MgmtKey; width: string }[] = [
  { id: "compact", label: "map.compact", width: "40%" },
  { id: "balanced", label: "map.balanced", width: "50%" },
  { id: "focus", label: "map.focus", width: "68%" },
];
const MAP_SIZE_KEY = "vono.controlRoom.mapSize";
/** the map column is never narrower than the one-row region strip (owner: no scrolling there, ever) */
const REGION_ROW_MIN_PX = 680;

/** The connected-station list is only sent on request — ask again so a station that drops shows Offline. */
const LIVE_REFRESH_MS = 10_000;

function rowStatus(row: Row, liveKnown: boolean): RowStatus {
  if (!row.online && !row.hasStation) return "install"; // no station yet — known from the DB, not from live status
  if (!liveKnown) return "unknown";
  if (!row.online) return "offline";
  return row.state?.status === "playing" ? "playing" : "idle";
}

export function AllBranchesView() {
  const L = useMgmt();
  const { branches: liveBranches, remoteStateByDeviceId, status, refreshBranchList, sendCommandTo, sendCommandWithAck } = useRemoteOwner();
  const [dbBranches, setDbBranches] = useState<DbBranch[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  /** bump to reload the branch list (after add / edit) */
  const [reloadKey, setReloadKey] = useState(0);
  /** owner: add / edit branch form in the right column */
  const [form, setForm] = useState<{ mode: "add" } | { mode: "edit"; id: string } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** part 2: the branch whose control panel is open (row / arrow / map dot) */
  const [openId, setOpenId] = useState<string | null>(null);
  const openBranch = (id: string) => { setSelectedId(id); setOpenId(id); setBroadcastOpen(false); setForm(null); setBrandsOpen(false); setJinglesOpen(false); };
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  /** Organization → Brand → Branch (owner): brands + which brand each branch belongs to */
  const [brandsData, setBrandsData] = useState<BrandsData | null>(null);
  const [brandsOpen, setBrandsOpen] = useState(false);
  /** Control Room → Jingles (HQ): the jingles panel in the right column (the map / filters stay = the context stays) */
  const [jinglesOpen, setJinglesOpen] = useState(false);
  /** Create Jingle open → the jingles column slides to 2/3 of the screen, the map to 1/3 (owner 2026-10-14, "curtain") */
  const [jingleCreating, setJingleCreating] = useState(false);
  const wideJingles = jinglesOpen && jingleCreating;
  /** HQ = access type OWNER (the existing permission mechanism) — HQ-only jingle actions are shown only to HQ */
  const [isHQ, setIsHQ] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { accessType?: string } | null) => { if (!cancelled) setIsHQ(d?.accessType === "OWNER"); })
      .catch(() => { /* not HQ */ });
    return () => { cancelled = true; };
  }, []);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  /** regional map: the focused region (null = All Israel) + branch search — combined with the brand filter */
  const [regionFocus, setRegionFocus] = useState<RegionId | null>(null);
  const [mapSize, setMapSizeState] = useState<MapSize>("balanced");
  /** the map header toolbar hosts the map's + / − / Fit */
  const [zoomSlot, setZoomSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(MAP_SIZE_KEY);
      if (v === "compact" || v === "balanced" || v === "focus") setMapSizeState(v);
    } catch { /* storage unavailable → Balanced */ }
  }, []);
  const setMapSize = (v: MapSize) => {
    setMapSizeState(v);
    try { window.localStorage.setItem(MAP_SIZE_KEY, v); } catch { /* not remembered */ }
  };
  /** entering a region from Compact opens the map to at least Balanced */
  const focusRegion = (id: RegionId) => setRegionFocus(id); // the chosen map size stays (owner: Compact stays Compact)
  const size = MAP_SIZES.find((m) => m.id === mapSize) ?? MAP_SIZES[1];
  const [search, setSearch] = useState("");
  /** KPI counters = the status filter (owner 2026-10-12): click → map + list; click again / All branches → clear */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/control-room/brands", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: BrandsData) => { if (!cancelled && Array.isArray(d?.brands)) setBrandsData(d); })
      .catch(() => { /* brands unavailable → the view works exactly as before (no badges / filter) */ });
    return () => { cancelled = true; };
  }, [reloadKey]);
  const brandById = useMemo(() => new Map((brandsData?.brands ?? []).map((b) => [b.id, b] as const)), [brandsData]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/branches", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: unknown) => {
        if (cancelled) return;
        setDbBranches(Array.isArray(rows) ? (rows as DbBranch[]).filter((b) => b && typeof b.id === "string") : []);
      })
      .catch(() => { if (!cancelled) setLoadError(true); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  useEffect(() => {
    if (status !== "connected") return;
    const id = setInterval(refreshBranchList, LIVE_REFRESH_MS);
    return () => clearInterval(id);
    // refreshBranchList is a fresh function each render; the interval only needs the latest socket (read inside it)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const liveKnown = status === "connected";

  const rows: Row[] = useMemo(() => {
    // join on the canonical branch id (a station may register with a legacy alias such as "default")
    const liveById = new Map(liveBranches.map((b) => [b.canonicalBranchId || b.branchId, b] as const));
    const out: Row[] = (dbBranches ?? []).map((b) => {
      const live = liveById.get(b.id) ?? null;
      liveById.delete(b.id);
      return {
        id: b.id,
        name: b.name || b.code || "Branch",
        branchNumber: typeof b.locationCode === "string" && b.locationCode.trim() ? b.locationCode.trim() : null,
        city: b.city ?? "",
        country: b.country ?? "",
        formattedAddress: b.formattedAddress ?? null,
        googlePlaceId: b.googlePlaceId ?? null,
        street: b.street ?? "",
        houseNumber: b.houseNumber ?? "",
        latitude: typeof b.latitude === "number" ? b.latitude : null,
        longitude: typeof b.longitude === "number" ? b.longitude : null,
        hasStation: b.hasStation !== false,
        online: !!live,
        live,
        state: live ? remoteStateByDeviceId[live.masterDeviceId] ?? null : null,
        brandId: brandsData ? brandsData.branchBrand[b.id] ?? brandsData.defaultBrandId : null,
        ...(() => { const g = branchRegion(typeof b.latitude === "number" ? b.latitude : null, typeof b.longitude === "number" ? b.longitude : null); return { regionId: g.regionId, regionReason: g.reason }; })(),
      };
    });
    // a connected station whose branch is not in the list (legacy id) — still shown, never hidden
    for (const live of liveById.values()) {
      out.push({
        id: live.canonicalBranchId || live.branchId,
        name: live.branchName ?? "Connected station",
        branchNumber: null,
        city: "",
        country: "",
        formattedAddress: null,
        googlePlaceId: null,
        street: "",
        houseNumber: "",
        latitude: null,
        longitude: null,
        hasStation: true,
        online: true,
        live,
        state: remoteStateByDeviceId[live.masterDeviceId] ?? null,
        brandId: brandsData?.defaultBrandId ?? null,
        regionId: null,
        regionReason: "no_location",
      });
    }
    // live branches first (playing, then online), then offline, then not yet installed — by name inside a group
    const rank: Record<RowStatus, number> = { playing: 0, idle: 1, unknown: 2, offline: 3, install: 4 };
    return out.sort((a, b) => rank[rowStatus(a, liveKnown)] - rank[rowStatus(b, liveKnown)] || a.name.localeCompare(b.name));
  }, [dbBranches, liveBranches, remoteStateByDeviceId, liveKnown, brandsData]);

  // brand filter: the map, the list and the counters show the chosen brand only ("All brands" = every branch)
  const activeFilter = brandFilter !== "all" && brandById.has(brandFilter) ? brandFilter : "all";
  // Brand → Search → Region, all together (none replaces another). Broadcast keeps the BRAND scope only (its "All <brand>").
  // live statuses need live data: without it only "Needs installation" (from the DB) can filter
  const activeStatus: StatusFilter = liveKnown || statusFilter === "install" ? statusFilter : "all";
  const { brandRows, visibleRows, regionCounts, statusCounts, noLocationCount, outsideCount, filtersActive } =
    applyControlRoomFilters(rows, { brand: activeFilter, query: search, region: regionFocus, status: activeStatus, statusOf: (r) => rowStatus(r, liveKnown) });
  const jingleDeps: AudienceDeps = {
    brands: (brandsData?.brands ?? []).map((b) => ({ id: b.id, name: b.name, color: b.color })),
    branches: rows.map((r) => ({ id: r.id, brandId: r.brandId, regionId: r.regionId, name: r.name, branchNumber: r.branchNumber })),
  };
  const clearFilters = () => { setBrandFilter("all"); setSearch(""); setRegionFocus(null); setStatusFilter("all"); };
  const toggleStatus = (s: StatusFilter) => setStatusFilter((cur) => (s === "all" || cur === s ? "all" : s));
  const colorOf = (brandId: string | null) => (brandId ? brandById.get(brandId)?.color ?? DEFAULT_BRAND_COLOR : null);


  return (
    <div dir={L.dir} className="flex h-full min-h-[680px] flex-col overflow-hidden rounded-2xl border border-[color:var(--sb-border)] bg-[var(--sb-surface)]">
      <header className="flex items-center justify-between gap-6 border-b border-[color:var(--sb-border)] px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--sb-text)]">{L.t("cr.title")}</h1>
          <p className="text-xs text-[var(--sb-text-tertiary)]">
            {L.t(liveKnown ? "cr.live" : status === "connecting" ? "cr.connecting" : "cr.liveUnavailable")}
          </p>
        </div>
        {/* search lives in the header (owner 2026-10-16) — no separate row */}
        {dbBranches && rows.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center justify-center gap-3">
          <label className="relative flex min-w-[220px] max-w-md flex-1 items-center">
            <svg className="pointer-events-none absolute start-3.5 h-[18px] w-[18px] text-[var(--sb-text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={regionFocus ? L.t("cr.searchIn", { region: L.region(regionFocus) }) : L.t("cr.searchPlaceholder")}
              aria-label={L.t("cr.searchAria")}
              dir="auto"
              className="w-full rounded-xl border border-[color:var(--sb-border)] bg-white/[0.04] py-2 ps-10 pe-9 text-base text-[var(--sb-text)] placeholder:text-[var(--sb-text-tertiary)] focus:border-[color:var(--sb-accent)] focus:outline-none"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} className="absolute end-2 inline-flex h-6 w-6 items-center justify-center rounded text-[var(--sb-text-tertiary)] hover:text-[var(--sb-text)]" aria-label={L.t("cr.clearSearch")}>
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            ) : null}
          </label>
          <span className="text-sm text-[var(--sb-text-secondary)]">
            {L.t("cr.showing", { n: visibleRows.length, total: rows.length })}
          </span>
          {filtersActive ? (
            <button type="button" onClick={clearFilters} className="rounded-lg border border-[color:var(--sb-accent-border)] px-3 py-1.5 text-sm font-medium text-[var(--sb-accent)] hover:bg-[var(--sb-accent-soft)]">
              {L.t("cr.clearFilters")}
            </button>
          ) : null}
        </div>
        ) : <div className="flex-1" />}
        <div className="flex items-center gap-4">
        <NetworkCode />
        <button
          type="button"
          onClick={() => { setOpenId(null); setBroadcastOpen(false); setForm(null); setJinglesOpen(false); setBrandsOpen(true); }}
          disabled={!brandsData}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--sb-border-strong)] px-3.5 py-2 text-sm font-medium text-[var(--sb-text)] hover:bg-white/[0.06] disabled:opacity-40"
        >
          {L.t("cr.brands")}
        </button>
        <button
          type="button"
          onClick={() => { setOpenId(null); setBroadcastOpen(false); setBrandsOpen(false); setJinglesOpen(false); setForm({ mode: "add" }); }}
          disabled={!dbBranches}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--sb-border-strong)] px-3.5 py-2 text-sm font-medium text-[var(--sb-text)] hover:bg-white/[0.06] disabled:opacity-40"
        >
          <span aria-hidden>+</span> {L.t("cr.addBranch")}
        </button>
        {isHQ ? (
          <button
            type="button"
            onClick={() => { setForm(null); setBrandsOpen(false); setBroadcastOpen(false); setJinglesOpen(true); }}
            disabled={!dbBranches}
            aria-pressed={jinglesOpen}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2 text-sm font-medium text-[var(--sb-text)] hover:bg-white/[0.06] disabled:opacity-40 ${jinglesOpen ? "border-[color:var(--sb-accent)]" : "border-[color:var(--sb-border-strong)]"}`}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
            {L.t("jg.title")}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => { setOpenId(null); setForm(null); setBrandsOpen(false); setJinglesOpen(false); setBroadcastOpen(true); }}
          disabled={!liveKnown || !dbBranches}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black transition-transform active:scale-95 disabled:opacity-40"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
          </svg>
          {L.t("cr.broadcast")}
        </button>
        </div>
      </header>

      {/* brands = the header of the screen (owner 2026-10-15), above the counters */}
      {brandsData && brandsData.brands.length > 1 ? (
        <div className="flex overflow-x-auto overflow-y-hidden border-b border-[color:var(--sb-border)]" role="group" aria-label={L.t("cr.brandsAria")}>
          {[{ id: "all", name: L.t("cr.allBrands"), color: null as string | null, logoUrl: null as string | null }, ...brandsData.brands].map((b) => (
            <FilterTab
              key={b.id}
              label={b.name}
              count={b.id === "all" ? rows.length : rows.filter((r) => r.brandId === b.id).length}
              active={activeFilter === b.id}
              dot={b.id === "all" ? null : b.color ?? DEFAULT_BRAND_COLOR}
              logo={b.logoUrl ?? null}
              bar={b.color ?? "#f5f5f7"}
              onClick={() => setBrandFilter(b.id)}
            />
          ))}
        </div>
      ) : null}

      {/* the KPI counters ARE the status filter (combined with Brand + Region + Search) */}
      <div className="grid grid-cols-2 border-b border-[color:var(--sb-border)] md:grid-cols-5" role="group" aria-label={L.t("cr.kpiAria")}>
        <Stat value={dbBranches ? statusCounts.all : "-"} L={L} label={L.t("status.all")} active={activeStatus === "all"} onClick={() => toggleStatus("all")} disabled={!dbBranches} />
        <Stat value={liveKnown ? statusCounts.playing : "-"} L={L} label={L.t("status.playing")} status="playing" active={activeStatus === "playing"} onClick={() => toggleStatus("playing")} disabled={!liveKnown} />
        <Stat value={liveKnown ? statusCounts.online : "-"} L={L} label={L.t("status.online")} status="idle" active={activeStatus === "online"} onClick={() => toggleStatus("online")} disabled={!liveKnown} />
        <Stat value={liveKnown ? statusCounts.offline : "-"} L={L} label={L.t("status.offline")} status="offline" active={activeStatus === "offline"} onClick={() => toggleStatus("offline")} disabled={!liveKnown} />
        <Stat value={dbBranches ? statusCounts.install : "-"} L={L} label={L.t("status.install")} status="install" active={activeStatus === "install"} onClick={() => toggleStatus("install")} disabled={!dbBranches} valueColor={statusCounts.install > 0 ? "#fbbf24" : undefined} last />
      </div>



      {loadError ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">{L.t("cr.loadError")}</p>
      ) : dbBranches === null ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">{L.t("cr.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">{L.t("cr.noBranches")}</p>
      ) : (
        <div
          className="grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none lg:grid-cols-[var(--cr-map-w)_minmax(0,1fr)]"
          style={{ "--cr-map-w": wideJingles ? "max(33.333%, 320px)" : `max(${size.width}, ${REGION_ROW_MIN_PX}px)` } as CSSProperties}
        >
          <div className="hidden min-h-0 min-w-0 flex-col overflow-hidden border-e border-[color:var(--sb-border)] lg:flex">
            {/* map header: the place (All Israel / region) + ONE toolbar — map size (LED under the chosen one) and zoom */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-[color:var(--sb-border)] px-6 pt-1">
              <div className="flex min-w-0 items-baseline gap-3 py-2" title={L.t("map.regionsHint", { branches: L.branches(visibleRows.length), regions: REGIONS.length })}>
                <div className="truncate text-xl font-semibold text-[var(--sb-text)]">{regionFocus ? L.region(regionFocus) : L.t("map.allIsrael")}</div>
              </div>
              <div className="flex items-center" role="toolbar" aria-label={L.t("map.sizeAria")}>
                <div className="flex items-center" role="radiogroup" aria-label={L.t("map.sizeAria")}>
                  {MAP_SIZES.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={mapSize === m.id}
                      onClick={() => setMapSize(m.id)}
                      title={L.t("map.sizeTitle", { label: L.t(m.label) })}
                      className={`relative flex h-11 items-center whitespace-nowrap px-3 text-sm transition-colors ${
                        mapSize === m.id ? "font-semibold text-[var(--sb-text)]" : "font-medium text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]"
                      }`}
                    >
                      {L.t(m.label)}
                      <span className={`absolute inset-x-2 bottom-0 h-[3px] rounded-full bg-[var(--sb-accent)] transition-opacity ${mapSize === m.id ? "opacity-100" : "opacity-0"}`} aria-hidden />
                    </button>
                  ))}
                </div>
                <span className="mx-1 h-5 w-px bg-white/[0.12]" aria-hidden />
                <span ref={setZoomSlot} className="flex items-center" />
              </div>
            </div>
            {/* regions: a strip right under the map header (All Israel is the first tab — no separate back button) */}
            <div className="flex overflow-hidden border-b border-[color:var(--sb-border)]" role="group" aria-label={L.t("map.regionsAria")}>
              <RegionChip label={L.t("map.allIsrael")} active={!regionFocus} onClick={() => setRegionFocus(null)} />
              {REGIONS.map((r) => (
                <RegionChip key={r.id} label={L.region(r.id)} title={L.branches(regionCounts[r.id] ?? 0)} active={regionFocus === r.id} onClick={() => (regionFocus === r.id ? setRegionFocus(null) : focusRegion(r.id))} />
              ))}
            </div>
            <div className="relative flex min-h-0 flex-1 items-stretch justify-center px-6 pb-5">
              {/* legend: one under the other, on the left side of the map (owner) */}
              <ul className="pointer-events-none absolute left-6 top-2 z-10 flex flex-col gap-1.5 text-sm text-[var(--sb-text-secondary)]" aria-label={L.t("map.legendAria")}>
                {(["idle", "playing", "offline", "install"] as const).map((st) => (
                  <li key={st} className="flex items-center gap-2"><StatusGlyph status={st} size={12} />{L.t(st === "idle" ? "status.online" : STATUS_KEY[st])}</li>
                ))}
                <li className="mt-0.5 text-xs text-[var(--sb-text-tertiary)]">{L.t("map.colorIsBrand")}</li>
              </ul>
              {/* a region with nothing matching the brand / status / search: say so, and offer the way out (owner) */}
              {regionFocus && visibleRows.length === 0 ? (
                <div className="absolute inset-x-6 top-1/2 z-20 mx-auto max-w-sm -translate-y-1/2 rounded-2xl border border-[color:var(--sb-border-strong)] bg-[rgba(18,18,22,0.96)] p-5 text-center shadow-xl">
                  <p className="text-base font-medium text-[var(--sb-text)]">{L.t("map.emptyInRegion", { region: L.region(regionFocus) })}</p>
                  <button type="button" onClick={() => setRegionFocus(null)} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-base font-semibold text-black active:scale-95">
                    {L.t("map.showAllIsrael")}
                  </button>
                </div>
              ) : null}
              {/* the branch count of the place on screen — big, right side of the map (opposite the legend) */}
              <div className="pointer-events-none absolute right-6 top-2 z-10 text-right" aria-live="polite">
                <div className="text-5xl font-bold leading-none tabular-nums text-[var(--sb-text)]" dir="ltr">{visibleRows.length}</div>
                <div className="mt-1 text-sm text-[var(--sb-text-secondary)]">{L.t("map.branchesLabel")}</div>
              </div>
              <p className="pointer-events-none absolute bottom-1 start-6 text-[10px] text-[var(--sb-text-tertiary)]">{L.t("map.attribution")}</p>
              <NetworkMap
                branches={visibleRows.map((r) => ({ id: r.id, name: r.name, city: r.city, latitude: r.latitude, longitude: r.longitude, status: rowStatus(r, liveKnown), brandColor: colorOf(r.brandId) }))}
                selectedId={selectedId}
                onSelect={openBranch}
                regions={{ counts: regionCounts, focus: regionFocus, onFocus: focusRegion }}
                height="100%"
                controlsSlot={zoomSlot}
              />
            </div>
            {!regionFocus && (noLocationCount > 0 || outsideCount > 0) ? (
              <p className="px-6 pb-2 text-xs text-[var(--sb-text-tertiary)]">
                {noLocationCount > 0 ? (noLocationCount === 1 ? L.t("map.noLocationOne") : L.t("map.noLocationMany", { n: noLocationCount })) : ""}
                {noLocationCount > 0 && outsideCount > 0 ? " · " : ""}
                {outsideCount > 0 ? L.t("map.outside", { n: outsideCount }) : ""}
              </p>
            ) : null}
          </div>
          {(() => {
            if (form) {
              const editing = form.mode === "edit" ? rows.find((r) => r.id === form.id) : undefined;
              return (
                <div className="min-h-0 min-w-0 overflow-y-auto">
                  <BranchForm
                    key={form.mode === "edit" ? form.id : "add"}
                    mode={form.mode}
                    branchId={editing?.id}
                    initial={editing ? { name: editing.name, branchNumber: editing.branchNumber ?? "", currentLocation: editing.formattedAddress || [editing.street, editing.houseNumber, editing.city].filter(Boolean).join(" ") || null, brandId: editing.brandId } : activeFilter !== "all" ? { brandId: activeFilter } : undefined}
                    brands={brandsData?.brands ?? null}
                    onCancel={() => setForm(null)}
                    onDone={(id) => {
                      setForm(null);
                      setReloadKey((k) => k + 1);
                      if (id) { setSelectedId(id); setOpenId(id); }
                    }}
                  />
                </div>
              );
            }
            if (jinglesOpen && isHQ) {
              return (
                <div className="min-h-0 min-w-0 overflow-y-auto">
                  <JinglesHqPanel
                    deps={jingleDeps}
                    L={L}
                    suggestion={suggestAudience({ brandId: activeFilter !== "all" ? activeFilter : null, region: regionFocus, branchId: openId })}
                    onClose={() => setJinglesOpen(false)}
                    onCreatingChange={setJingleCreating}
                  />
                </div>
              );
            }
            if (brandsOpen && brandsData) {
              return (
                <div className="min-h-0 min-w-0 overflow-y-auto">
                  <BrandManager brands={brandsData.brands} onClose={() => setBrandsOpen(false)} onChanged={() => setReloadKey((k) => k + 1)} />
                </div>
              );
            }
            if (broadcastOpen) {
              return (
                <div className="min-h-0 min-w-0 overflow-y-auto">
                  <BroadcastPanel
                    key={activeFilter}
                    targets={brandRows.map((r) => {
                      const st = rowStatus(r, liveKnown);
                      return { id: r.id, name: r.name, branchNumber: r.branchNumber, status: st, liveBranchId: r.live && (st === "playing" || st === "idle") ? r.live.branchId : null, brandId: r.brandId, regionId: r.regionId };
                    })}
                    scope={activeFilter !== "all" && brandById.has(activeFilter) ? { name: brandById.get(activeFilter)!.name, color: brandById.get(activeFilter)!.color } : null}
                    onClose={() => setBroadcastOpen(false)}
                    sendCommandWithAck={sendCommandWithAck}
                  />
                </div>
              );
            }
            const open = openId ? rows.find((r) => r.id === openId) : undefined;
            if (open) {
              return (
                <div className="min-h-0 min-w-0 overflow-y-auto">
                  <BranchPanel
                    branch={{ id: open.id, name: open.name, branchNumber: open.branchNumber, city: open.city, status: rowStatus(open, liveKnown), live: open.live, state: open.state, hasStation: open.hasStation }}
                    onBack={() => setOpenId(null)}
                    onEdit={() => setForm({ mode: "edit", id: open.id })}
                    sendCommandTo={sendCommandTo}
                  />
                  {/* the branch's jingles: "Branch jingles" + "Available to this branch" (same library, server-filtered) */}
                  <BranchJingles
                    key={open.id}
                    branch={{ id: open.id, name: open.name, branchNumber: open.branchNumber, liveBranchId: open.live && (rowStatus(open, liveKnown) === "playing" || rowStatus(open, liveKnown) === "idle") ? open.live.branchId : null }}
                    deps={jingleDeps}
                    isHQ={isHQ}
                    L={L}
                    sendCommandWithAck={sendCommandWithAck}
                  />
                </div>
              );
            }
            return (
              <ul className="min-h-0 min-w-0 divide-y divide-[color:var(--sb-border)] overflow-y-auto">
                {visibleRows.length === 0 ? (
                  <li className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">
                    {L.t(filtersActive ? "cr.noMatch" : "cr.noBranches")}{" "}
                    {filtersActive ? <button type="button" onClick={clearFilters} className="font-medium text-[var(--sb-accent)] hover:underline">{L.t("cr.clearFilters")}</button> : null}
                  </li>
                ) : null}
                {visibleRows.map((r) => (
                  <BranchRow
                    key={r.id}
                    row={r}
                    brand={r.brandId ? brandById.get(r.brandId) ?? null : null}
                    status={rowStatus(r, liveKnown)}
                    L={L}
                    selected={r.id === selectedId}
                    onSelect={() => openBranch(r.id)}
                  />
                ))}
              </ul>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const STATUS_TEXT_CLASS: Record<RowStatus, string> = {
  playing: "text-[var(--sb-text)]",
  idle: "text-[var(--sb-text-secondary)]",
  offline: "text-[var(--sb-text-tertiary)]",
  install: "text-amber-300/90",
  unknown: "text-[var(--sb-text-tertiary)]",
};

function BranchRow({ L, row, brand, status, selected, onSelect }: { L: Mgmt; row: Row; brand: BrandRow | null; status: RowStatus; selected: boolean; onSelect: () => void }) {
  // secondary only: what plays, one muted line (no artwork — light at hundreds of branches)
  const nowPlaying = status === "playing" ? row.state?.currentTrack?.title || row.state?.currentSource?.title || "" : "";
  return (
    <li
      data-branch-id={row.id}
      onClick={onSelect}
      className={`grid cursor-pointer grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_16px] items-center gap-4 px-6 py-4 transition-colors ${
        selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-lg font-semibold text-[var(--sb-text)]" dir="auto">{row.name}</span>
          {brand ? <BrandBadge name={brand.name} color={brand.color} logoUrl={brand.logoUrl} /> : null}
        </div>
        {row.branchNumber || row.city ? (
          <div className="truncate text-xs text-[var(--sb-text-secondary)]">
            {row.branchNumber ? <span className="font-medium tabular-nums">{L.t("common.branchNumber", { n: row.branchNumber })}</span> : null}
            {row.branchNumber && row.city ? <span className="text-[var(--sb-text-tertiary)]"> · </span> : null}
            {row.city ? <span className="text-[var(--sb-text-tertiary)]">{row.city}</span> : null}
            {row.regionReason === "no_location" ? <span className="text-amber-300/80"> · {L.t("cr.noLocation")}</span> : null}
          </div>
        ) : row.regionReason === "no_location" ? (
          <div className="truncate text-xs text-amber-300/80">{L.t("cr.noLocation")}</div>
        ) : null}
      </div>
      <div className={`flex min-w-0 items-center gap-2 text-base ${STATUS_TEXT_CLASS[status]}`}>
        <StatusLed status={status} size={13} />
        <span className="truncate">{L.t(STATUS_KEY[status])}</span>
      </div>
      <DeviceType L={L} type={row.online ? row.live?.deviceType : undefined} />
      <div className="min-w-0 truncate text-sm text-[var(--sb-text-tertiary)]" title={nowPlaying || undefined}>
        {nowPlaying || ""}
      </div>
      {/* opens the branch control panel (the whole row is clickable) */}
      <svg className="h-4 w-4 text-[var(--sb-text-secondary)] rtl:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </li>
  );
}

/** The kind of device playing in the branch (info only; shown while the station is online). */
function DeviceType({ L, type }: { L: Mgmt; type?: "computer" | "streamer" | "browser" | "unknown" }) {
  if (!type || type === "unknown") return <span className="text-sm text-[var(--sb-text-tertiary)]" />;
  const common = { className: "h-4 w-4 shrink-0", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-sm text-[var(--sb-text-secondary)]">
      {type === "computer" ? (
        <svg {...common}><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg>
      ) : type === "streamer" ? (
        <svg {...common}><rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 12h.01M10 12h.01" /></svg>
      ) : (
        <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>
      )}
      <span className="truncate">{L.t(`device.${type}`)}</span>
    </span>
  );
}
