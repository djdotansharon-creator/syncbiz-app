/**
 * Shuffle order for a playing list (owner 2026-10-28):
 * - Random ON plays the list in a random order and goes through EVERY song once before a new random round starts;
 * - the song that ends a round never opens the next one (no song twice in a row);
 * - the AutoMix pre-load PEEKS at the next song without drawing, so what is pre-loaded is exactly what plays next;
 * - a list ends (explicit LOOP "off" only) when its ROUND is complete — never because the shuffle landed on the list's
 *   last position.
 * One order per list (keyed by its tracks): another list — or the same list re-ordered — starts its own round.
 * A song picked by hand mid-round counts as played in that round; the rest of the round continues. A song picked after the
 * round has played in full (e.g. the list is started again after it ended) opens a new round.
 * `advance` may be called twice for the same step (React can re-run a state updater): the repeat returns the same song.
 */
export class ShuffleOrder {
  private key = "";
  private order: number[] = [];
  private pos = 0;
  private nextRound: number[] | null = null;
  private last: { key: string; from: number; to: number } | null = null;
  private finished: { key: string; epoch: number } | null = null;

  constructor(private readonly rand: () => number = Math.random) {}

  private permutation(len: number): number[] {
    const a = Array.from({ length: len }, (_, i) => i);
    for (let i = len - 1; i > 0; i--) {
      const j = Math.floor(this.rand() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }

  /** Bring the order in line with what is playing now (a new list, or a song picked by hand). */
  private sync(key: string, len: number, current: number): void {
    const cur = current >= 0 && current < len ? current : 0;
    if (this.order[this.pos] === cur && key === this.key && this.order.length === len) return;
    const j = key === this.key && this.order.length === len ? this.order.indexOf(cur) : -1;
    if (j < 0 || (j < this.pos && this.pos >= len - 1)) {
      // another list — or a song picked again after the whole round has played: a new round starts with it
      const rest = this.permutation(len).filter((i) => i !== cur);
      this.key = key;
      this.order = [cur, ...rest];
      this.pos = 0;
      this.nextRound = null;
      this.last = null;
      return;
    }
    // picked by hand mid-round: it counts as played now; every song not played yet stays due in this round
    this.order.splice(j, 1);
    if (j < this.pos) this.pos -= 1;
    this.order.splice(this.pos + 1, 0, cur);
    this.pos += 1;
    this.nextRound = null;
  }

  private upcomingRound(len: number, current: number): number[] {
    if (!this.nextRound) {
      const next = this.permutation(len);
      if (len > 1 && next[0] === current) {
        const k = 1 + Math.floor(this.rand() * (len - 1));
        [next[0], next[k]] = [next[k]!, next[0]!];
      }
      this.nextRound = next;
    }
    return this.nextRound;
  }

  /** The list stopped at the end of its round (explicit LOOP "off"); the next play command opens a new round. */
  finish(key: string, epoch: number): void {
    this.finished = { key, epoch };
  }

  /** Called with the current play-command epoch before every read: a new play command after a finished round starts afresh. */
  atEpoch(epoch: number): void {
    if (this.finished && this.finished.epoch !== epoch) {
      this.finished = null;
      this.key = "";
    }
  }

  /** True when `current` is the last song of this round (every song has played once). */
  roundEnds(key: string, len: number, current: number): boolean {
    if (len <= 1) return true;
    this.sync(key, len, current);
    return this.pos >= len - 1;
  }

  /** The song that plays after `current` — without moving on (for the pre-load). */
  peek(key: string, len: number, current: number): number {
    if (len <= 1) return 0;
    this.sync(key, len, current);
    if (this.pos + 1 < len) return this.order[this.pos + 1]!;
    return this.upcomingRound(len, current)[0]!;
  }

  /** Move on from `current` to the next song of the order (a new round when this one is complete). */
  advance(key: string, len: number, current: number): number {
    if (len <= 1) return 0;
    const l = this.last;
    if (l && l.key === key && l.from === current && this.order[this.pos] === l.to && l.from !== l.to) return l.to;
    this.sync(key, len, current);
    let to: number;
    if (this.pos + 1 < len) {
      this.pos += 1;
      to = this.order[this.pos]!;
    } else {
      this.order = this.upcomingRound(len, current);
      this.nextRound = null;
      this.pos = 0;
      to = this.order[0]!;
    }
    this.last = { key, from: current, to };
    return to;
  }
}

/** Identity of a list's track order (cheap FNV-1a over the track ids / urls). */
export function shuffleKeyOf(tracks: ReadonlyArray<{ id?: string; url?: string }>): string {
  let h = 0x811c9dc5;
  for (const t of tracks) {
    const s = `${t.id ?? t.url ?? ""}|`;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
  }
  return `${tracks.length}:${(h >>> 0).toString(36)}`;
}
