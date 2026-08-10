/**
 * Phase C / Stage B — PlaybackSourceResolver.
 *
 * Decides WHERE a UniversalTrack can be played, in the order local → youtube → soundcloud
 * → unresolved. It NEVER changes the player: it only writes ProviderMappings (type+url the
 * existing player already knows how to play). Only a SAFE match is stored automatically;
 * ambiguous stays for manual review. Live/Cover/Karaoke/wrong-Remix are filtered by the
 * existing conservative scorer. SoundCloud candidates are INJECTED (interface/fixture only
 * until an official API exists — no scraping). Local refs resolve to a real path only on
 * the desktop; here a local mapping is just the opaque ref.
 */

import type { PrismaClient } from "@prisma/client";
import { titleHasForbiddenSignal } from "@/lib/m3u-youtube-bulk-confidence";
import { pickSafeYouTubeVideoId, type FallbackRow, type YouTubeCandidateProvider } from "@/lib/universal/youtube-fallback";

export type PlaybackProviderKind = "local" | "youtube" | "soundcloud";

export interface PlayableCandidate {
  provider: PlaybackProviderKind;
  externalId: string;
  externalUrl?: string;
  confidence: number;
  matchMethod: string;
}

export interface PlaybackResolution {
  universalTrackId: string;
  status: "resolved" | "provider_resolved" | "ambiguous" | "unresolved";
  chosen: PlayableCandidate | null;
  candidates: PlayableCandidate[];
  newMappingCreated: boolean;
}

/** SoundCloud candidate source — injected (fixture/tests now; official API later). No scraping. */
export type SoundCloudCandidateProvider = (query: string, row: FallbackRow) => Promise<Array<{ title: string; url: string }>>;

const PRIORITY: PlaybackProviderKind[] = ["local", "youtube", "soundcloud"];

export interface PlaybackSourceResolver {
  resolveLocal(universalTrackId: string): Promise<PlayableCandidate | null>;
  resolveYouTube(universalTrackId: string, row?: FallbackRow): Promise<PlayableCandidate | null>;
  resolveSoundCloud(universalTrackId: string, row?: FallbackRow): Promise<PlayableCandidate | null>;
  getPlayableCandidates(universalTrackId: string): Promise<PlayableCandidate[]>;
  verifyAvailability(candidate: PlayableCandidate): Promise<boolean>;
  choosePreferredSource(candidates: PlayableCandidate[]): PlayableCandidate | null;
  resolvePlayback(universalTrackId: string, opts?: { apply?: boolean; row?: FallbackRow }): Promise<PlaybackResolution>;
}

export class DbPlaybackSourceResolver implements PlaybackSourceResolver {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly deps: { youtubeCandidateProvider?: YouTubeCandidateProvider; soundcloudCandidateProvider?: SoundCloudCandidateProvider } = {},
  ) {}

  private async existing(universalTrackId: string, provider: PlaybackProviderKind): Promise<PlayableCandidate | null> {
    const m = await this.prisma.providerMapping.findFirst({ where: { universalTrackId, provider }, select: { externalId: true, externalUrl: true, matchConfidence: true, matchMethod: true } });
    return m ? { provider, externalId: m.externalId, externalUrl: m.externalUrl ?? undefined, confidence: m.matchConfidence ?? 1, matchMethod: m.matchMethod ?? "exact_id" } : null;
  }

  resolveLocal(universalTrackId: string): Promise<PlayableCandidate | null> {
    return this.existing(universalTrackId, "local");
  }

  async resolveYouTube(universalTrackId: string, row?: FallbackRow): Promise<PlayableCandidate | null> {
    const found = await this.existing(universalTrackId, "youtube");
    if (found) return found;
    if (!row || !this.deps.youtubeCandidateProvider) return null;
    const query = [row.artist, row.title].filter(Boolean).join(" ").trim();
    const candidates = await this.deps.youtubeCandidateProvider(query, row);
    const pick = pickSafeYouTubeVideoId(row, candidates);
    return pick ? { provider: "youtube", externalId: pick.videoId, externalUrl: pick.url, confidence: 0.9, matchMethod: "safe_search" } : null;
  }

  async resolveSoundCloud(universalTrackId: string, row?: FallbackRow): Promise<PlayableCandidate | null> {
    const found = await this.existing(universalTrackId, "soundcloud");
    if (found) return found;
    if (!row || !this.deps.soundcloudCandidateProvider) return null;
    const query = [row.artist, row.title].filter(Boolean).join(" ").trim();
    const raw = await this.deps.soundcloudCandidateProvider(query, row);
    // Reuse the version guard: drop Live/Cover/Karaoke/Remix unless the query asked for it.
    const safe = raw.find((c) => !titleHasForbiddenSignal(c.title, query));
    return safe ? { provider: "soundcloud", externalId: safe.url, externalUrl: safe.url, confidence: 0.8, matchMethod: "safe_search" } : null;
  }

  async getPlayableCandidates(universalTrackId: string): Promise<PlayableCandidate[]> {
    const out: PlayableCandidate[] = [];
    for (const p of PRIORITY) {
      const c = await this.existing(universalTrackId, p);
      if (c) out.push(c);
    }
    return out;
  }

  async verifyAvailability(_candidate: PlayableCandidate): Promise<boolean> {
    // No network check in the MVP — an existing mapping is assumed available. (Real check later.)
    return true;
  }

  choosePreferredSource(candidates: PlayableCandidate[]): PlayableCandidate | null {
    for (const p of PRIORITY) {
      const c = candidates.find((x) => x.provider === p);
      if (c) return c;
    }
    return null;
  }

  async resolvePlayback(universalTrackId: string, opts: { apply?: boolean; row?: FallbackRow } = {}): Promise<PlaybackResolution> {
    const apply = opts.apply === true;
    const existing = await this.getPlayableCandidates(universalTrackId);
    if (existing.length > 0) {
      const chosen = this.choosePreferredSource(existing)!;
      return { universalTrackId, status: "resolved", chosen, candidates: existing, newMappingCreated: false };
    }

    // No mapping yet → safe search: youtube, then soundcloud. Distinguish "no candidates"
    // (unresolved) from "candidates but none safe" (ambiguous — kept for manual review).
    const row = opts.row;
    let ambiguous = false;
    const q = row ? [row.artist, row.title].filter(Boolean).join(" ").trim() : "";

    if (row && this.deps.youtubeCandidateProvider) {
      const cands = await this.deps.youtubeCandidateProvider(q, row);
      const pick = pickSafeYouTubeVideoId(row, cands);
      if (pick) {
        const cand: PlayableCandidate = { provider: "youtube", externalId: pick.videoId, externalUrl: pick.url, confidence: 0.9, matchMethod: "safe_search" };
        return { universalTrackId, status: "provider_resolved", chosen: cand, candidates: [cand], newMappingCreated: await this.persist(universalTrackId, cand, apply) };
      }
      if (cands.length > 0) ambiguous = true;
    }

    if (row && this.deps.soundcloudCandidateProvider) {
      const raw = await this.deps.soundcloudCandidateProvider(q, row);
      const safe = raw.find((c) => !titleHasForbiddenSignal(c.title, q));
      if (safe) {
        const cand: PlayableCandidate = { provider: "soundcloud", externalId: safe.url, externalUrl: safe.url, confidence: 0.8, matchMethod: "safe_search" };
        return { universalTrackId, status: "provider_resolved", chosen: cand, candidates: [cand], newMappingCreated: await this.persist(universalTrackId, cand, apply) };
      }
      if (raw.length > 0) ambiguous = true;
    }

    return { universalTrackId, status: ambiguous ? "ambiguous" : "unresolved", chosen: null, candidates: [], newMappingCreated: false };
  }

  /** Persist a safe mapping (apply only). Only a safe match is ever auto-saved. */
  private async persist(universalTrackId: string, cand: PlayableCandidate, apply: boolean): Promise<boolean> {
    if (!apply) return false;
    await this.prisma.providerMapping.upsert({
      where: { provider_externalId: { provider: cand.provider, externalId: cand.externalId } },
      update: { playableStatus: "PLAYABLE", matchMethod: cand.matchMethod, matchConfidence: cand.confidence, lastVerifiedAt: new Date() },
      create: { universalTrackId, provider: cand.provider, externalId: cand.externalId, externalUrl: cand.externalUrl, playableStatus: "PLAYABLE", matchMethod: cand.matchMethod, matchConfidence: cand.confidence },
    });
    return true;
  }
}
