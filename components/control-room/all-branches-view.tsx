"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";
import type { BranchSummary, StationPlaybackState } from "@/lib/remote-control/types";
import { DOT_FILL, StatusGlyph, type MapDotStatus } from "@/components/control-room/branch-map";
import { NetworkMap } from "@/components/control-room/network-map";
import { BranchPanel } from "@/components/control-room/branch-panel";
import { BroadcastPanel } from "@/components/control-room/broadcast-panel";
import { BranchForm } from "@/components/control-room/branch-form";
import { NetworkCode } from "@/components/control-room/network-code";
import { BrandManager, BrandBadge, DEFAULT_BRAND_COLOR, type BrandRow } from "@/components/control-room/brand-manager";
import { REGIONS, branchRegion, regionName, type RegionId } from "@/lib/control-room-regions";
import { applyControlRoomFilters } from "@/lib/control-room-filters";

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
const MAP_SIZES: { id: MapSize; label: string; width: string; height: string }[] = [
  { id: "compact", label: "Compact", width: "35%", height: "min(540px, 68vh)" },
  { id: "balanced", label: "Balanced", width: "50%", height: "min(640px, 74vh)" },
  { id: "focus", label: "Map focus", width: "68%", height: "min(780px, 80vh)" },
];
const MAP_SIZE_KEY = "vono.controlRoom.mapSize";

/** The connected-station list is only sent on request — ask again so a station that drops shows Offline. */
const LIVE_REFRESH_MS = 10_000;

function rowStatus(row: Row, liveKnown: boolean): RowStatus {
  if (!row.online && !row.hasStation) return "install"; // no station yet — known from the DB, not from live status
  if (!liveKnown) return "unknown";
  if (!row.online) return "offline";
  return row.state?.status === "playing" ? "playing" : "idle";
}

export function AllBranchesView() {
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
  const openBranch = (id: string) => { setSelectedId(id); setOpenId(id); setBroadcastOpen(false); setForm(null); setBrandsOpen(false); };
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  /** Organization → Brand → Branch (owner): brands + which brand each branch belongs to */
  const [brandsData, setBrandsData] = useState<BrandsData | null>(null);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  /** regional map: the focused region (null = All Israel) + branch search — combined with the brand filter */
  const [regionFocus, setRegionFocus] = useState<RegionId | null>(null);
  const [mapSize, setMapSizeState] = useState<MapSize>("balanced");
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
  const focusRegion = (id: RegionId) => { setRegionFocus(id); if (mapSize === "compact") setMapSize("balanced"); };
  const size = MAP_SIZES.find((m) => m.id === mapSize) ?? MAP_SIZES[1];
  const [search, setSearch] = useState("");

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
  const { brandRows, visibleRows, regionCounts, noLocationCount, outsideCount, filtersActive } =
    applyControlRoomFilters(rows, { brand: activeFilter, query: search, region: regionFocus });
  const clearFilters = () => { setBrandFilter("all"); setSearch(""); setRegionFocus(null); };
  const colorOf = (brandId: string | null) => (brandId ? brandById.get(brandId)?.color ?? DEFAULT_BRAND_COLOR : null);

  const onlineCount = visibleRows.filter((r) => r.online).length;
  const playingCount = visibleRows.filter((r) => rowStatus(r, liveKnown) === "playing").length;
  const installCount = visibleRows.filter((r) => rowStatus(r, liveKnown) === "install").length;

  return (
    <div className="overflow-hidden rounded-2xl border border-[color:var(--sb-border)] bg-[var(--sb-surface)]">
      <header className="flex items-center justify-between gap-4 border-b border-[color:var(--sb-border)] px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-[var(--sb-text)]">Control Room</h1>
          <p className="text-xs text-[var(--sb-text-tertiary)]">
            {liveKnown ? "Your network, live" : status === "connecting" ? "Connecting to live status…" : "Live status unavailable. Reconnecting…"}
          </p>
        </div>
        <div className="flex items-center gap-4">
        <NetworkCode />
        <button
          type="button"
          onClick={() => { setOpenId(null); setBroadcastOpen(false); setForm(null); setBrandsOpen(true); }}
          disabled={!brandsData}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--sb-border-strong)] px-3.5 py-2 text-sm font-medium text-[var(--sb-text)] hover:bg-white/[0.06] disabled:opacity-40"
        >
          Brands
        </button>
        <button
          type="button"
          onClick={() => { setOpenId(null); setBroadcastOpen(false); setBrandsOpen(false); setForm({ mode: "add" }); }}
          disabled={!dbBranches}
          className="inline-flex items-center gap-1.5 rounded-xl border border-[color:var(--sb-border-strong)] px-3.5 py-2 text-sm font-medium text-[var(--sb-text)] hover:bg-white/[0.06] disabled:opacity-40"
        >
          <span aria-hidden>+</span> Add branch
        </button>
        <button
          type="button"
          onClick={() => { setOpenId(null); setForm(null); setBrandsOpen(false); setBroadcastOpen(true); }}
          disabled={!liveKnown || !dbBranches}
          className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-black transition-transform active:scale-95 disabled:opacity-40"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="2" /><path d="M16.24 7.76a6 6 0 0 1 0 8.49M7.76 16.24a6 6 0 0 1 0-8.49M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14" />
          </svg>
          Broadcast
        </button>
        </div>
      </header>

      <div className="grid grid-cols-2 border-b border-[color:var(--sb-border)] md:grid-cols-4">
        <Stat value={dbBranches ? visibleRows.length : "-"} label="Branches" />
        <Stat value={liveKnown ? onlineCount : "-"} label="Online" dot={DOT_FILL.idle} />
        <Stat value={liveKnown ? playingCount : "-"} label="Playing" dot={DOT_FILL.playing} />
        <Stat value={dbBranches ? installCount : "-"} label="Needs installation" dot={DOT_FILL.install} valueColor={installCount > 0 ? "#fbbf24" : undefined} last />
      </div>

      {brandsData && brandsData.brands.length > 1 ? (
        <nav className="flex items-end gap-6 overflow-x-auto border-b border-[color:var(--sb-border)] px-6" aria-label="Brands">
          {[{ id: "all", name: "All brands", color: null as string | null }, ...brandsData.brands].map((b) => {
            const on = activeFilter === b.id;
            const count = b.id === "all" ? rows.length : rows.filter((r) => r.brandId === b.id).length;
            return (
              <button
                key={b.id}
                type="button"
                onClick={() => setBrandFilter(b.id)}
                aria-pressed={on}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 py-3 text-sm transition-colors ${on ? "font-medium text-[var(--sb-text)]" : "border-transparent text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]"}`}
                style={on ? { borderBottomColor: b.color ?? "#ffffff" } : undefined}
              >
                {b.id !== "all" ? <span className="h-2 w-2 rounded-full" style={{ background: b.color ?? DEFAULT_BRAND_COLOR }} aria-hidden /> : null}
                <span dir="auto">{b.name}</span>
                <span className="text-xs tabular-nums text-[var(--sb-text-tertiary)]">{count}</span>
              </button>
            );
          })}
        </nav>
      ) : null}

      {dbBranches && rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--sb-border)] px-6 py-3">
          <label className="relative flex min-w-[220px] max-w-md flex-1 items-center">
            <svg className="pointer-events-none absolute left-3 h-4 w-4 text-[var(--sb-text-tertiary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={regionFocus ? `Search in ${regionName(regionFocus)}` : "Search branches: name, number or city"}
              aria-label="Search branches"
              dir="auto"
              className="w-full rounded-lg border border-[color:var(--sb-border)] bg-white/[0.04] py-2 pl-9 pr-8 text-sm text-[var(--sb-text)] placeholder:text-[var(--sb-text-tertiary)] focus:border-[color:var(--sb-accent)] focus:outline-none"
            />
            {search ? (
              <button type="button" onClick={() => setSearch("")} className="absolute right-2 inline-flex h-6 w-6 items-center justify-center rounded text-[var(--sb-text-tertiary)] hover:text-[var(--sb-text)]" aria-label="Clear search">
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
              </button>
            ) : null}
          </label>
          <span className="text-xs text-[var(--sb-text-secondary)]">
            Showing <span className="tabular-nums text-[var(--sb-text)]">{visibleRows.length}</span> of <span className="tabular-nums">{rows.length}</span>
          </span>
          {filtersActive ? (
            <button type="button" onClick={clearFilters} className="text-xs font-medium text-[var(--sb-accent)] hover:underline">
              Clear filters
            </button>
          ) : null}
        </div>
      ) : null}

      {loadError ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">Could not load branches. Refresh the page to try again.</p>
      ) : dbBranches === null ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">Loading branches…</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">No branches yet.</p>
      ) : (
        <div
          className="grid transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none lg:grid-cols-[var(--cr-map-w)_minmax(0,1fr)]"
          style={{ "--cr-map-w": size.width } as CSSProperties}
        >
          <div className="hidden min-w-0 flex-col border-r border-[color:var(--sb-border)] lg:flex">
            <div className="flex items-center justify-between gap-3 px-6 pb-1 pt-4">
              {regionFocus ? (
                <div className="min-w-0">
                  <button type="button" onClick={() => setRegionFocus(null)} className="inline-flex items-center gap-1 text-xs font-medium text-[var(--sb-accent)] hover:underline">
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m15 18-6-6 6-6" /></svg>
                    All Israel
                  </button>
                  <div className="mt-1 truncate text-lg font-semibold text-[var(--sb-text)]">{regionName(regionFocus)}</div>
                  <div className="text-xs text-[var(--sb-text-secondary)]">{visibleRows.length} branch{visibleRows.length === 1 ? "" : "es"}</div>
                </div>
              ) : (
                <div className="min-w-0">
                  <div className="text-lg font-semibold text-[var(--sb-text)]">All Israel</div>
                  <div className="text-xs text-[var(--sb-text-secondary)]">
                    {visibleRows.length} branch{visibleRows.length === 1 ? "" : "es"} · {REGIONS.length} regions · hover a region, click to focus
                  </div>
                </div>
              )}
              <div className="flex shrink-0 rounded-lg border border-[color:var(--sb-border)] bg-white/[0.03] p-0.5" role="radiogroup" aria-label="Map size">
                {MAP_SIZES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={mapSize === m.id}
                    onClick={() => setMapSize(m.id)}
                    title={`Map size: ${m.label}`}
                    className={`relative rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors before:absolute before:-inset-y-1.5 before:inset-x-0 before:content-[''] ${
                      mapSize === m.id ? "bg-white/[0.10] text-[var(--sb-text)]" : "text-[var(--sb-text-secondary)] hover:text-[var(--sb-text)]"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center px-6 pb-2">
              <NetworkMap
                branches={visibleRows.map((r) => ({ id: r.id, name: r.name, city: r.city, latitude: r.latitude, longitude: r.longitude, status: rowStatus(r, liveKnown), brandColor: colorOf(r.brandId) }))}
                selectedId={selectedId}
                onSelect={openBranch}
                regions={{ counts: regionCounts, focus: regionFocus, onFocus: focusRegion }}
                height={size.height}
              />
            </div>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 px-6 pb-3 text-xs text-[var(--sb-text-secondary)]" aria-label="Map legend">
              {(["playing", "idle", "offline", "install"] as const).map((s) => (
                <li key={s} className="flex items-center gap-2"><StatusGlyph status={s} size={14} />{STATUS_LABEL[s].label}</li>
              ))}
              <li className="flex items-center gap-2 text-[var(--sb-text-tertiary)]">Center = brand color</li>
            </ul>
            {!regionFocus && (noLocationCount > 0 || outsideCount > 0) ? (
              <p className="px-6 pb-4 text-xs text-[var(--sb-text-tertiary)]">
                {noLocationCount > 0 ? `${noLocationCount} branch${noLocationCount === 1 ? "" : "es"} without a location (not on the map, still in the list)` : ""}
                {noLocationCount > 0 && outsideCount > 0 ? " · " : ""}
                {outsideCount > 0 ? `${outsideCount} outside Israel (shown on All Israel only)` : ""}
              </p>
            ) : null}
            <p className="px-6 pb-4 text-[10px] text-[var(--sb-text-tertiary)]">VONO Operational Regions · based on official sub-district boundaries · © OpenStreetMap contributors</p>
          </div>
          {(() => {
            if (form) {
              const editing = form.mode === "edit" ? rows.find((r) => r.id === form.id) : undefined;
              return (
                <div className="max-h-[640px] overflow-y-auto">
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
            if (brandsOpen && brandsData) {
              return (
                <div className="max-h-[640px] overflow-y-auto">
                  <BrandManager brands={brandsData.brands} onClose={() => setBrandsOpen(false)} onChanged={() => setReloadKey((k) => k + 1)} />
                </div>
              );
            }
            if (broadcastOpen) {
              return (
                <div className="max-h-[640px] overflow-y-auto">
                  <BroadcastPanel
                    key={activeFilter}
                    targets={brandRows.map((r) => {
                      const st = rowStatus(r, liveKnown);
                      return { id: r.id, name: r.name, branchNumber: r.branchNumber, status: st, liveBranchId: r.live && (st === "playing" || st === "idle") ? r.live.branchId : null, brandId: r.brandId };
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
                <div className="max-h-[640px] overflow-y-auto">
                  <BranchPanel
                    branch={{ id: open.id, name: open.name, branchNumber: open.branchNumber, city: open.city, status: rowStatus(open, liveKnown), live: open.live, state: open.state, hasStation: open.hasStation }}
                    onBack={() => setOpenId(null)}
                    onEdit={() => setForm({ mode: "edit", id: open.id })}
                    sendCommandTo={sendCommandTo}
                  />
                </div>
              );
            }
            return (
              <ul className="max-h-[640px] divide-y divide-[color:var(--sb-border)] overflow-y-auto">
                {visibleRows.length === 0 ? (
                  <li className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">
                    {filtersActive ? "No branches match these filters." : "No branches yet."}{" "}
                    {filtersActive ? <button type="button" onClick={clearFilters} className="font-medium text-[var(--sb-accent)] hover:underline">Clear filters</button> : null}
                  </li>
                ) : null}
                {visibleRows.map((r) => (
                  <BranchRow
                    key={r.id}
                    row={r}
                    brand={r.brandId ? brandById.get(r.brandId) ?? null : null}
                    status={rowStatus(r, liveKnown)}
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

function Stat({ value, label, dot, last, valueColor }: { value: number | string; label: string; dot?: string; last?: boolean; valueColor?: string }) {
  return (
    <div className={`px-6 py-5 ${last ? "" : "border-r border-[color:var(--sb-border)]"}`}>
      <div className="text-4xl font-bold leading-none tracking-tight tabular-nums text-[var(--sb-text)]" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--sb-text-secondary)]">
        {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} aria-hidden /> : null}
        {label}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<RowStatus, { label: string; text: string }> = {
  playing: { label: "Playing", text: "text-[var(--sb-text)]" },
  idle: { label: "Online · not playing", text: "text-[var(--sb-text-secondary)]" },
  offline: { label: "Offline", text: "text-[var(--sb-text-tertiary)]" },
  install: { label: "Needs installation", text: "text-amber-300/90" },
  unknown: { label: "-", text: "text-[var(--sb-text-tertiary)]" },
};

function BranchRow({ row, brand, status, selected, onSelect }: { row: Row; brand: BrandRow | null; status: RowStatus; selected: boolean; onSelect: () => void }) {
  const ui = STATUS_LABEL[status];
  // secondary only: what plays, one muted line (no artwork — light at hundreds of branches)
  const nowPlaying = status === "playing" ? row.state?.currentTrack?.title || row.state?.currentSource?.title || "" : "";
  return (
    <li
      data-branch-id={row.id}
      onClick={onSelect}
      className={`grid cursor-pointer grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,1.3fr)_16px] items-center gap-4 px-6 py-3.5 transition-colors ${
        selected ? "bg-white/[0.06]" : "hover:bg-white/[0.03]"
      }`}
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-base font-semibold text-[var(--sb-text)]">{row.name}</span>
          {brand ? <BrandBadge name={brand.name} color={brand.color} /> : null}
        </div>
        {row.branchNumber || row.city ? (
          <div className="truncate text-xs text-[var(--sb-text-secondary)]">
            {row.branchNumber ? <span className="font-medium tabular-nums">Branch {row.branchNumber}</span> : null}
            {row.branchNumber && row.city ? <span className="text-[var(--sb-text-tertiary)]"> · </span> : null}
            {row.city ? <span className="text-[var(--sb-text-tertiary)]">{row.city}</span> : null}
            {row.regionReason === "no_location" ? <span className="text-amber-300/80"> · No location</span> : null}
          </div>
        ) : row.regionReason === "no_location" ? (
          <div className="truncate text-xs text-amber-300/80">No location</div>
        ) : null}
      </div>
      <div className={`flex min-w-0 items-center gap-2 text-sm ${ui.text}`}>
        <StatusGlyph status={status} />
        <span className="truncate">{ui.label}</span>
      </div>
      <DeviceType type={row.online ? row.live?.deviceType : undefined} />
      <div className="min-w-0 truncate text-sm text-[var(--sb-text-tertiary)]" title={nowPlaying || undefined}>
        {nowPlaying || ""}
      </div>
      {/* opens the branch control panel (the whole row is clickable) */}
      <svg className="h-4 w-4 text-[var(--sb-text-secondary)]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="m9 18 6-6-6-6" />
      </svg>
    </li>
  );
}

const DEVICE_LABEL: Record<"computer" | "streamer" | "browser", string> = { computer: "Computer", streamer: "Streamer", browser: "Browser" };

/** The kind of device playing in the branch (info only; shown while the station is online). */
function DeviceType({ type }: { type?: "computer" | "streamer" | "browser" | "unknown" }) {
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
      <span className="truncate">{DEVICE_LABEL[type]}</span>
    </span>
  );
}
