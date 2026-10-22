"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { applyControlRoomFilters, type StatusFilter } from "@/lib/control-room-filters";
import { useRemoteOwner } from "@/lib/remote-control/ws-client";
import type { BranchSummary, StationPlaybackState } from "@/lib/remote-control/types";
import { StatusLed, STATUS_KEY, type MapDotStatus } from "@/components/control-room/branch-map";
import { NetworkMap } from "@/components/control-room/network-map";
import { BranchPanel } from "@/components/control-room/branch-panel";
import { BroadcastPanel } from "@/components/control-room/broadcast-panel";
import { BranchForm } from "@/components/control-room/branch-form";
import { BranchCreateFlow } from "@/components/control-room/branch-create-flow";
import { ConfirmDelete, deleteRefusalText, type DeleteRefusal } from "@/components/control-room/confirm-delete";
import { NetworkCode } from "@/components/control-room/network-code";
import { BrandManager, DEFAULT_BRAND_COLOR, type BrandRow } from "@/components/control-room/brand-manager";
import { FilterTab, Stat } from "@/components/management/primitives";
import { ManagementTabs } from "@/components/management/management-tabs";
import { Marquee } from "@/components/control-room/marquee";
import { ColorPanel, useColorMode } from "@/components/control-room/color-panel";
import { RegionTitle } from "@/components/control-room/region-title";
import { BranchJingles, JinglesHqPanel } from "@/components/control-room/jingles-panels";
import { suggestAudience, type AudienceDeps } from "@/components/control-room/jingle-audience";
import { REGIONS, branchRegion, type RegionId } from "@/lib/control-room-regions";
import { useMgmt } from "@/lib/i18n/use-mgmt";
import { useCrDensity } from "@/lib/use-cr-density";
import { DensityMenu } from "@/components/control-room/density-menu";
import { LOGO_AS_IS, useLogoFit } from "@/components/control-room/logo-fit";
import { BrandStrip, type StripItem } from "@/components/control-room/brand-strip";
import type { Mgmt } from "@/lib/i18n/management";
import { useTr } from "@/lib/i18n/use-tr";

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
  /** the branch's own logo (file-backed) */
  logoUrl?: string | null;
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
  /** the branch's own logo — preferred over the brand's logo in the list */
  logoUrl: string | null;
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
  const tr = useTr();
  const [density, setDensity] = useCrDensity();
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
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const openBranch = (id: string) => { setSelectedId(id); setOpenId(id); setBroadcastOpen(false); setForm(null); setBrandsOpen(false); setJinglesOpen(false); };
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  /** Organization → Brand → Branch (owner): brands + which brand each branch belongs to */
  const [brandsData, setBrandsData] = useState<BrandsData | null>(null);
  const [brandsOpen, setBrandsOpen] = useState(false);
  /** opened from the "+ Add brand" chip → straight into the new-brand form */
  const [brandsNew, setBrandsNew] = useState(false);
  /** Control Room → Jingles (HQ): the jingles panel in the right column (the map / filters stay = the context stays) */
  const [jinglesOpen, setJinglesOpen] = useState(false);
  /** Create Jingle open → the jingles column slides to 2/3 of the screen, the map to 1/3 (owner 2026-10-14, "curtain") */
  const [, setJingleCreating] = useState(false);
  const wideJingles = jinglesOpen; // the Jingles panel opens at its full width at once — it used to widen suddenly when "Create" was pressed
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
  /** the chosen brands (none = every brand) — several can be chosen at once (owner 2026-10-20) */
  const [brandFilters, setBrandFilters] = useState<string[]>([]);
  /** regional map: the focused region (null = All Israel) + branch search — combined with the brand filter */
  const [regionFocus, setRegionFocus] = useState<RegionId | null>(null);
  /** the map's toolbar (+ / − / Fit) is rendered into this slot in the map header */
  const [zoomSlot, setZoomSlot] = useState<HTMLElement | null>(null);
  const focusRegion = (id: RegionId | null) => setRegionFocus(id);
  /** colours (owner 2026-10-19): the display mode is a per-viewer preference; the brand colours themselves are edited in the colour panel */
  const [colorMode, setColorMode] = useColorMode();
  const [colorsOpen, setColorsOpen] = useState(false);
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
        // the owner's OWN player (the legacy "default" branch) reads "You" (owner 2026-10-20)
        name: b.id === "default" ? L.t("cr.you") : b.name || b.code || "Branch",
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
        logoUrl: typeof b.logoUrl === "string" ? b.logoUrl : null,
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
        logoUrl: null,
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
  const selectedBrands = brandFilters.filter((id) => brandById.has(id));
  // the single-brand consumers (broadcast "All <brand>", the jingle audience, the add-branch default) follow a brand only when exactly ONE is chosen
  const activeFilter = selectedBrands.length === 1 ? selectedBrands[0]! : "all";
  const toggleBrand = (id: string) => setBrandFilters((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  // Brand → Search → Region, all together (none replaces another). Broadcast keeps the BRAND scope only (its "All <brand>").
  // live statuses need live data: without it only "Needs installation" (from the DB) can filter
  const activeStatus: StatusFilter = liveKnown || statusFilter === "install" ? statusFilter : "all";
  const { brandRows, visibleRows, regionCounts, statusCounts, noLocationCount, outsideCount, filtersActive } =
    applyControlRoomFilters(rows, { brand: selectedBrands, query: search, region: regionFocus, status: activeStatus, statusOf: (r) => rowStatus(r, liveKnown) });
  const jingleDeps: AudienceDeps = {
    brands: (brandsData?.brands ?? []).map((b) => ({ id: b.id, name: b.name, color: b.color })),
    branches: rows.map((r) => ({ id: r.id, brandId: r.brandId, regionId: r.regionId, name: r.name, branchNumber: r.branchNumber })),
  };
  // a branch is open (its screen replaces the list) — not while Jingles / Brands / Broadcast own the column
  const detail = !!openId && rows.some((r) => r.id === openId) && !(jinglesOpen && isHQ) && !(brandsOpen && !!brandsData) && !broadcastOpen;
  const clearFilters = () => { setBrandFilters([]); setSearch(""); setRegionFocus(null); setStatusFilter("all"); };
  const toggleStatus = (s: StatusFilter) => setStatusFilter((cur) => (s === "all" || cur === s ? "all" : s));
  const colorOf = (brandId: string | null) => (brandId ? brandById.get(brandId)?.color ?? DEFAULT_BRAND_COLOR : null);
  /** the song playing in a branch right now (for the map's long-hover bubble) */
  const nowOf = (r: Row, st: RowStatus) => {
    const s = r.state;
    if (!s || (st !== "playing" && st !== "idle") || (s.status !== "playing" && s.status !== "paused")) return null;
    const title = s.currentTrack?.title || s.currentSource?.title || "";
    if (!title) return null;
    return { title, cover: s.currentTrack?.cover ?? s.currentSource?.cover ?? null, position: s.position ?? 0, duration: s.duration ?? 0, positionAt: s.positionAt ?? 0, playing: s.status === "playing" };
  };


  return (
    <div dir={L.dir} data-cr-colors={colorMode} className="cr-stage flex h-full min-h-[680px] flex-col gap-4 px-1 pb-1">
      {/* the page header: the title (+ the page tabs) on one side, the actions on the other — nothing else */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-1 pt-1">
        <ManagementTabs />
        <div className="flex flex-wrap items-center gap-2.5">
          <NetworkCode />
          <button
            type="button"
            onClick={() => { setOpenId(null); setBroadcastOpen(false); setForm(null); setJinglesOpen(false); setBrandsNew(false); setBrandsOpen(true); }}
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

      {loadError ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">{L.t("cr.loadError")}</p>
      ) : dbBranches === null ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">{L.t("cr.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="px-6 py-8 text-sm text-[var(--sb-text-secondary)]">{L.t("cr.noBranches")}</p>
      ) : (
        <div
          className="grid min-h-0 flex-1 gap-4 transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none lg:grid-cols-[minmax(0,1fr)_var(--cr-map-w)]"
          style={{ "--cr-map-w": wideJingles ? "clamp(300px, 26vw, 420px)" : "clamp(380px, 33vw, 540px)" } as CSSProperties}
        >
          {/* LEFT: filters, counters and the list / panels */}
          <div className="flex min-h-0 min-w-0 flex-col gap-3">
            {/* while ONE branch is open the brand strip, the counters and the search fold away (they filter the list, which is not on screen) — owner 2026-10-21 */}
            <div className={`cr-fold${detail ? " is-folded" : ""}`} inert={detail}>
              <div className="cr-fold-in">
              {brandsData && brandsData.brands.length > 1 ? (
                <BrandStrip
                  label={L.t("cr.brandsAria")}
                  moreLabel={L.t("cr.brandsMore")}
                  lessLabel={L.t("cr.brandsLess")}
                  items={[
                    { id: "all", pinned: true, node: <FilterTab label={L.t("cr.allBrands")} active={selectedBrands.length === 0} dot={null} logo={null} bar="#f5f5f7" onClick={() => setBrandFilters([])} /> },
                    // the default brand (the owner's own player — "VONO") goes LAST, after every chain (owner 2026-10-21)
                    ...[...brandsData.brands.filter((b) => !b.isDefault), ...brandsData.brands.filter((b) => b.isDefault)].map((b): StripItem => ({
                      id: b.id,
                      chosen: selectedBrands.includes(b.id),
                      node: <FilterTab label={b.name} active={selectedBrands.includes(b.id)} check={selectedBrands.includes(b.id)} dot={b.color ?? DEFAULT_BRAND_COLOR} logo={b.logoUrl ?? null} bar={b.color ?? "#f5f5f7"} onClick={() => toggleBrand(b.id)} />,
                    })),
                    // where brands are created: the "+" is the LAST item of the list (owner 2026-10-21) — in the row after the last chip, or at the end of the opened rows; never counted as a brand
                    { id: "__add", plain: true, node: (
                      <button type="button" className="cr-chip cr-chip--plus shrink-0" onClick={() => { setOpenId(null); setBroadcastOpen(false); setForm(null); setJinglesOpen(false); setBrandsNew(true); setBrandsOpen(true); }} title={L.t("brand.add")} aria-label={L.t("brand.add")}>
                      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" aria-hidden><path d="M12 5v14M5 12h14" /></svg>
                    </button>
                    ) },
                  ]}
                />
              ) : null}

              {/* the KPI counters ARE the status filter (combined with Brand + Region + Search) */}
              <div className="cr-stats grid grid-cols-5" role="group" aria-label={L.t("cr.kpiAria")}>
                <Stat value={dbBranches ? statusCounts.all : "-"} L={L} label={L.t("status.all")} active={activeStatus === "all"} onClick={() => toggleStatus("all")} disabled={!dbBranches} />
                <Stat value={liveKnown ? statusCounts.playing : "-"} L={L} label={L.t("status.playing")} status="playing" active={activeStatus === "playing"} onClick={() => toggleStatus("playing")} disabled={!liveKnown} />
                <Stat value={liveKnown ? statusCounts.online : "-"} L={L} label={L.t("status.online")} status="idle" active={activeStatus === "online"} onClick={() => toggleStatus("online")} disabled={!liveKnown} />
                <Stat value={liveKnown ? statusCounts.offline : "-"} L={L} label={L.t("status.offline")} status="offline" active={activeStatus === "offline"} onClick={() => toggleStatus("offline")} disabled={!liveKnown} />
                <Stat value={dbBranches ? statusCounts.install : "-"} L={L} label={L.t("status.install")} status="install" active={activeStatus === "install"} onClick={() => toggleStatus("install")} disabled={!dbBranches} last />
              </div>

              {/* search + the regions (a single scrolling row — they filter the list AND focus the map) */}
              <div className="flex min-w-0 flex-col gap-2">
                <div className="flex min-w-0 items-center justify-center gap-3">
                  <label className="relative flex min-w-[200px] max-w-md flex-1 items-center">
                    <svg className="pointer-events-none absolute start-3.5 h-[18px] w-[18px] text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
                    <input
                      type="search"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder=""
                      aria-label={L.t("cr.searchAria")}
                      dir={search ? "auto" : L.dir}
                      className="cr-search w-full py-2.5 ps-11 pe-9 text-base text-[var(--sb-text)] placeholder:text-[var(--sb-text-tertiary)] focus:outline-none"
                    />
                    {search ? (
                      <button type="button" onClick={() => setSearch("")} className="absolute end-2 inline-flex h-6 w-6 items-center justify-center rounded text-[var(--sb-text-tertiary)] hover:text-[var(--sb-text)]" aria-label={L.t("cr.clearSearch")}>
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg>
                      </button>
                    ) : null}
                  </label>
                  <span className="shrink-0 text-sm tabular-nums text-[var(--sb-text-secondary)]" dir="ltr" title={L.t("cr.showing", { n: visibleRows.length, total: rows.length })}>{visibleRows.length}/{rows.length}</span>
                  {/* how big the list is drawn: an icon that opens Large (2 per row) · Medium (3) · Small (5) (owner 2026-10-20) */}
                  <DensityMenu L={L} value={density} onChange={setDensity} />
                  {filtersActive ? (
                    <button type="button" onClick={clearFilters} className="shrink-0 rounded-lg border border-[color:var(--sb-accent-border)] px-3 py-1.5 text-sm font-medium text-[var(--sb-accent)] hover:bg-[var(--sb-accent-soft)]">
                      {L.t("cr.clearFilters")}
                    </button>
                  ) : null}
                </div>
              </div>
              </div>
            </div>

            <div className="cr-list-host flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {(() => {
            if (jinglesOpen && isHQ) {
              return (
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
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
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                  <BrandManager key={brandsNew ? "new" : "list"} startNew={brandsNew} brands={brandsData.brands} onClose={() => { setBrandsOpen(false); setBrandsNew(false); }} onChanged={() => setReloadKey((k) => k + 1)} />
                </div>
              );
            }
            if (broadcastOpen) {
              return (
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                  <BroadcastPanel
                    key={activeFilter}
                    targets={brandRows.map((r) => {
                      const st = rowStatus(r, liveKnown);
                      return { id: r.id, name: r.name, branchNumber: r.branchNumber, status: st, liveBranchId: r.live && (st === "playing" || st === "idle") ? r.live.branchId : null, brandId: r.brandId, regionId: r.regionId };
                    })}
                    scope={selectedBrands.length === 1 ? { name: brandById.get(selectedBrands[0]!)!.name, color: brandById.get(selectedBrands[0]!)!.color } : selectedBrands.length > 1 ? { name: selectedBrands.map((id) => brandById.get(id)!.name).join(" + "), color: null } : null}
                    onClose={() => setBroadcastOpen(false)}
                    sendCommandWithAck={sendCommandWithAck}
                  />
                </div>
              );
            }
            const open = openId ? rows.find((r) => r.id === openId) : undefined;
            if (open) {
              return (
                <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                  <BranchPanel
                    branch={{ id: open.id, name: open.name, branchNumber: open.branchNumber, city: open.city, status: rowStatus(open, liveKnown), live: open.live, state: open.state, hasStation: open.hasStation, logoUrl: open.logoUrl || (open.brandId ? brandById.get(open.brandId)?.logoUrl : null) || null, brandName: open.brandId ? brandById.get(open.brandId)?.name ?? null : null, brandColor: open.brandId ? brandById.get(open.brandId)?.color ?? DEFAULT_BRAND_COLOR : null }}
                    onBack={() => setOpenId(null)}
                    onEdit={() => setForm({ mode: "edit", id: open.id })}
                    onDelete={() => setDeleting({ id: open.id, name: open.name })}
                    sendCommandTo={sendCommandTo}
                  >
                  {/* the branch's jingles: "Branch jingles" + "Available to this branch" (same library, server-filtered) */}
                  <BranchJingles
                    key={open.id}
                    branch={{ id: open.id, name: open.name, branchNumber: open.branchNumber, liveBranchId: open.live && (rowStatus(open, liveKnown) === "playing" || rowStatus(open, liveKnown) === "idle") ? open.live.branchId : null }}
                    deps={jingleDeps}
                    isHQ={isHQ}
                    L={L}
                    sendCommandWithAck={sendCommandWithAck}
                  />
                  </BranchPanel>
                </div>
              );
            }
            return (
              <ul className="cr-list min-h-0 min-w-0 flex-1 overflow-y-auto p-2.5" data-density={density}>
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
          </div>

          {/* RIGHT: the map — no frame, the whole column; the title floats top-left, the zoom controls bottom-right (nothing steals height) */}
          <div className="cr-map relative hidden min-h-0 min-w-0 lg:block">
            <div className="absolute start-4 top-3 z-20 flex min-w-0 items-baseline gap-3">
              <RegionTitle
                value={regionFocus}
                onPick={(id) => setRegionFocus(id as RegionId | null)}
                options={[{ id: null, label: L.t("map.allIsrael"), count: brandRows.length }, ...REGIONS.map((r) => ({ id: r.id as string, label: L.region(r.id), count: regionCounts[r.id] ?? 0 }))]}
                hint={L.t("map.regionsHint", { branches: L.branches(visibleRows.length), regions: REGIONS.length })}
              />
            </div>
            {/* just the number, at the far end of the title line (owner 2026-10-20: "62" — not "62 branches") */}
            <div className="cr-map-count pointer-events-none absolute end-5 top-3 z-20 text-sm tabular-nums text-[var(--sb-text-secondary)]" aria-live="polite" title={L.branches(visibleRows.length)}>{visibleRows.length}</div>
            {!regionFocus && (noLocationCount > 0 || outsideCount > 0) ? (
              <span className="cr-map-note pointer-events-none absolute bottom-3 start-3 z-10 max-w-[44%] text-xs leading-snug text-[var(--sb-text-tertiary)]">
                {noLocationCount > 0 ? (noLocationCount === 1 ? L.t("map.noLocationOne") : L.t("map.noLocationMany", { n: noLocationCount })) : ""}
                {noLocationCount > 0 && outsideCount > 0 ? " · " : ""}
                {outsideCount > 0 ? L.t("map.outside", { n: outsideCount }) : ""}
              </span>
            ) : null}
            {colorsOpen && brandsData ? (
              <ColorPanel brands={brandsData.brands} mode={colorMode} onMode={setColorMode} onChanged={() => setReloadKey((k) => k + 1)} onClose={() => setColorsOpen(false)} />
            ) : null}
            <div className="absolute bottom-2 end-1 z-10 flex items-center gap-1">
              <span ref={setZoomSlot} className="flex items-center" />
              <button type="button" data-cr-colors-btn onClick={() => setColorsOpen((v) => !v)} aria-pressed={colorsOpen} aria-label={tr("Colours")} title={tr("Colours")} className={`cr-zoom-btn ${colorsOpen ? "is-on" : ""}`}>
                <svg className="h-[17px] w-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1 .8-1.7 1.8-1.7H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3Z" /><circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" /><circle cx="10" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="7" r="1" fill="currentColor" stroke="none" /></svg>
              </button>
              <span className="cr-info" title={L.t("map.attribution")} aria-label={L.t("map.attribution")} role="img">i</span>
            </div>
            <div className="cr-map-panel absolute inset-0 flex items-stretch justify-center">
              {/* a region with nothing matching the brand / status / search: say so, and offer the way out */}
              {regionFocus && visibleRows.length === 0 ? (
                <div className="absolute inset-x-6 top-1/2 z-20 mx-auto max-w-sm -translate-y-1/2 rounded-3xl bg-[rgba(30,30,36,0.92)] p-5 text-center shadow-xl">
                  <p className="text-base font-medium text-[var(--sb-text)]">{L.t("map.emptyInRegion", { region: L.region(regionFocus) })}</p>
                  <button type="button" onClick={() => setRegionFocus(null)} className="mt-4 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-base font-semibold text-black active:scale-95">
                    {L.t("map.showAllIsrael")}
                  </button>
                </div>
              ) : null}
              <NetworkMap
                // while ONE branch is open the map shows only it, with its white bubble pinned open (owner 2026-10-21)
                branches={(detail ? visibleRows.filter((r) => r.id === openId).concat(rows.filter((r) => r.id === openId && !visibleRows.some((v) => v.id === r.id))) : visibleRows).map((r) => ({ id: r.id, name: r.name, city: r.city, latitude: r.latitude, longitude: r.longitude, status: rowStatus(r, liveKnown), brandColor: colorOf(r.brandId), branchNumber: r.branchNumber, brandName: r.brandId ? brandById.get(r.brandId)?.name ?? null : null, now: nowOf(r, rowStatus(r, liveKnown)) }))}
                selectedId={selectedId}
                pinnedId={detail ? openId : null}
                onSelect={openBranch}
                regions={{ counts: regionCounts, focus: regionFocus, onFocus: focusRegion }}
                height="100%"
                controlsSlot={zoomSlot}
                colorMode={colorMode}
              />
            </div>
          </div>
        </div>
      )}
      {/* delete a branch (owner 2026-10-22): asks first; the server refuses while a station is installed */}
      {deleting ? (
        <ConfirmDelete
          kind="branch"
          name={deleting.name}
          onClose={() => setDeleting(null)}
          onConfirm={async () => {
            try {
              const res = await fetch(`/api/control-room/branches/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
              if (!res.ok) return deleteRefusalText(L, (await res.json().catch(() => ({}))) as DeleteRefusal);
            } catch {
              return L.t("common.serverRetry");
            }
            setDeleting(null);
            setOpenId(null);
            setSelectedId(null);
            setReloadKey((k) => k + 1);
            return null;
          }}
        />
      ) : null}
      {/* add / edit a branch: a step-by-step dialog (Details → Brand → Location) */}
      {form && form.mode === "add" ? (
        /* adding: the writing flow (Name → Number → Brand → Location → Logo) — owner 2026-10-22; editing keeps the stepped dialog below */
        <BranchCreateFlow
          key="add"
          brands={brandsData?.brands ?? null}
          onDone={(id) => {
            setForm(null);
            if (id) { setReloadKey((k) => k + 1); setSelectedId(id); setOpenId(id); }
          }}
        />
      ) : form ? (
        (() => {
          const editing = form.mode === "edit" ? rows.find((r) => r.id === form.id) : undefined;
          return (
            <BranchForm
                                key={form.mode === "edit" ? form.id : "add"}
                                mode={form.mode}
                                branchId={editing?.id}
                                initial={editing ? { name: editing.name, branchNumber: editing.branchNumber ?? "", currentLocation: editing.formattedAddress || [editing.street, editing.houseNumber, editing.city].filter(Boolean).join(" ") || null, brandId: editing.brandId, logoUrl: editing.logoUrl } : activeFilter !== "all" ? { brandId: activeFilter } : undefined}
                                brands={brandsData?.brands ?? null}
                                onCancel={() => setForm(null)}
                                onLogoChanged={() => setReloadKey((k) => k + 1)}
                                onDone={(id) => {
                                  setForm(null);
                                  setReloadKey((k) => k + 1);
                                  if (id) { setSelectedId(id); setOpenId(id); }
                                }}
                              />
          );
        })()
      ) : null}
    </div>
  );
}

const STATUS_TEXT_CLASS: Record<RowStatus, string> = {
  playing: "text-[var(--sb-text)]",
  idle: "text-[var(--sb-text-secondary)]",
  offline: "text-[var(--sb-text-tertiary)]",
  install: "text-[var(--sb-text-secondary)]",
  unknown: "text-[var(--sb-text-tertiary)]",
};

function BranchRow({ L, row, brand, status, selected, onSelect }: { L: Mgmt; row: Row; brand: BrandRow | null; status: RowStatus; selected: boolean; onSelect: () => void }) {
  // what plays there, one line — a ticker when it is longer than its box
  const nowPlaying = status === "playing" ? row.state?.currentTrack?.title || row.state?.currentSource?.title || "" : "";
  // the whole row follows the language of the INTERFACE (Hebrew UI → every row right-to-left, even a Latin-lettered name) — owner 2026-10-20 (it used to follow each name)
  const color = brand?.color ?? DEFAULT_BRAND_COLOR;
  // the logo tile's letter: the LAST word of the brand (the format — "Shufersal Deal" → D), so the tiles tell the formats apart
  const initial = ((brand?.name || row.name).trim().split(/\s+/).pop() ?? "").charAt(0).toUpperCase();
  // the logo is drawn AS IT IS (own shape, no tile, no background — owner 2026-10-20) or, with LOGO_AS_IS off, fitted into its square tile — see logo-fit.ts
  const logoSrc = row.logoUrl || brand?.logoUrl || "";
  const fit = useLogoFit(logoSrc || null);
  const asis = LOGO_AS_IS && !!logoSrc && fit !== null; // while it loads, the slot stays empty (no white flash)
  return (
    <li data-branch-id={row.id} onClick={onSelect} dir={L.dir} className={`cr-row ${selected ? "is-selected" : ""}`}>
      {/* the logo: the brand's logo (Brands → logo) or its colour + initial — the branch's name beside it is never cut */}
      <span className={`cr-row-logo ${logoSrc ? "has-logo" : ""}${asis ? " is-asis" : fit ? " has-fit" : ""}${!asis && fit?.bleed ? " is-bleed" : ""}${logoSrc && fit === undefined ? " is-loading" : ""}${asis && fit?.dark ? " is-dark" : ""}`} style={{ ["--cr-brand" as string]: color, ...(!asis && fit ? { background: fit.bg } : {}) } as CSSProperties} aria-hidden>
        {logoSrc ? (
          fit === undefined ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={fit?.src ?? logoSrc} alt="" draggable={false} />
          )
        ) : (
          <span className="cr-row-initial">{initial}</span>
        )}
      </span>
      <span className={`cr-row-main${nowPlaying ? " has-now" : ""}`}>
        <span className="cr-row-name">{row.name}</span>
        <span className="cr-row-sub">
          {brand && !asis ? <span className="cr-row-brand"><i style={{ background: color }} aria-hidden />{brand.name}</span> : null}
          {row.city ? <span>{row.city}</span> : null}
          {row.branchNumber ? <span className="tabular-nums" dir="ltr">#{row.branchNumber}</span> : null}
          {row.regionReason === "no_location" ? <span className="text-amber-300/80">{L.t("cr.noLocation")}</span> : null}
        </span>
        <span className={`cr-row-status ${STATUS_TEXT_CLASS[status]}`}>
          <StatusLed status={status} size={11} />
          <span>{L.t(STATUS_KEY[status])}</span>
        </span>
        {nowPlaying ? (
          <span className="cr-row-now">
            <span className="cr-eq" aria-hidden><i /><i /><i /></span>
            <Marquee text={nowPlaying} />
          </span>
        ) : null}
      </span>
    </li>
  );
}
