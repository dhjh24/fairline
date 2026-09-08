import { create } from "zustand";
import { isFifteenCrypto, isPrintMarket } from "./crypto.ts";
import { MODEL_VERSION } from "./model.ts";
import type { CryptoFifteen, DeskMarket, DeskResponse, Signal } from "./types.ts";

const KEY = "fairline-calibration-v1";
const MAX_SNAPS = 400;

export type QuoteSnap = {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  title: string;
  eventTitle: string;
  category: string;
  closeTime: string;
  target?: number;
  mid: number;
  fair: number;
  bid: number;
  ask: number;
  signal: Signal;
  grok?: number;
  snappedAt: string;
  lastMid?: number;
  lastFair?: number;
  lastSnappedAt?: string;
  /** Immutable model version that produced `fair`. */
  modelVersion?: string;
};

export type Verdict = {
  ticker: string;
  result: "yes" | "no";
  resolvedAt: string;
};

export type ScoredRow = QuoteSnap & {
  result: "yes" | "no";
  y: 0 | 1;
  brier: number;
  marketBrier: number;
  skill: number;
  leadSec: number;
  informative: boolean;
  grokBrier?: number;
  signalHit?: boolean;
  sideHit: boolean;
};

type Persisted = {
  snaps: Record<string, QuoteSnap>;
  verdicts: Record<string, Verdict>;
};

type CalState = Persisted & {
  hydrated: boolean;
  hydrate: () => void;
  capture: (rows: QuoteSnap[]) => void;
  applyVerdicts: (rows: { ticker: string; result: "yes" | "no" }[]) => void;
};

function isSnap(v: unknown): v is QuoteSnap {
  if (!v || typeof v !== "object") return false;
  const s = v as QuoteSnap;
  return typeof s.ticker === "string" && typeof s.fair === "number" && typeof s.mid === "number";
}

function isVerdict(v: unknown): v is Verdict {
  if (!v || typeof v !== "object") return false;
  const r = v as Verdict;
  return typeof r.ticker === "string" && (r.result === "yes" || r.result === "no");
}

function read(): Persisted {
  if (typeof window === "undefined") return { snaps: {}, verdicts: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { snaps: {}, verdicts: {} };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const snaps: Record<string, QuoteSnap> = {};
    const verdicts: Record<string, Verdict> = {};
    if (parsed.snaps && typeof parsed.snaps === "object") {
      for (const [k, v] of Object.entries(parsed.snaps)) {
        if (isSnap(v)) snaps[k] = v;
      }
    }
    if (parsed.verdicts && typeof parsed.verdicts === "object") {
      for (const [k, v] of Object.entries(parsed.verdicts)) {
        if (isVerdict(v)) verdicts[k] = v;
      }
    }
    return { snaps, verdicts };
  } catch {
    return { snaps: {}, verdicts: {} };
  }
}

function write(state: Persisted) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

function prune(snaps: Record<string, QuoteSnap>, verdicts: Record<string, Verdict>) {
  const keys = Object.keys(snaps);
  if (keys.length <= MAX_SNAPS) return { snaps, verdicts };
  const ranked = keys.sort((a, b) => {
    const ta = Date.parse(snaps[a]?.snappedAt ?? "") || 0;
    const tb = Date.parse(snaps[b]?.snappedAt ?? "") || 0;
    return ta - tb;
  });
  const drop = ranked.slice(0, keys.length - MAX_SNAPS);
  const nextSnaps = { ...snaps };
  const nextVerdicts = { ...verdicts };
  for (const k of drop) {
    delete nextSnaps[k];
    delete nextVerdicts[k];
  }
  return { snaps: nextSnaps, verdicts: nextVerdicts };
}

export function brier(p: number, y: 0 | 1): number {
  const x = Math.min(1, Math.max(0, p));
  return (x - y) * (x - y);
}

export function snapLeadSec(closeTime: string, snappedAt: string): number {
  const close = Date.parse(closeTime);
  const snapped = Date.parse(snappedAt);
  if (!Number.isFinite(close) || !Number.isFinite(snapped)) return 0;
  return (close - snapped) / 1000;
}

export function isInformativeSnap(mid: number, closeTime: string, snappedAt: string): boolean {
  return mid > 0.08 && mid < 0.92 && snapLeadSec(closeTime, snappedAt) >= 90;
}

/** Keep the first honest quote. Later prints (often 99¢ / <90s) are last* only. */
export function mergeLiveSnap(prev: QuoteSnap | undefined, next: QuoteSnap): QuoteSnap {
  if (prev && isInformativeSnap(prev.mid, prev.closeTime, prev.snappedAt)) {
    return {
      ...prev,
      lastMid: next.mid,
      lastFair: next.fair,
      lastSnappedAt: next.snappedAt,
    };
  }
  return next;
}

export function scoredRows(
  snaps: Record<string, QuoteSnap>,
  verdicts: Record<string, Verdict>,
): ScoredRow[] {
  const out: ScoredRow[] = [];
  for (const snap of Object.values(snaps)) {
    const v = verdicts[snap.ticker];
    if (!v) continue;
    const y: 0 | 1 = v.result === "yes" ? 1 : 0;
    const signalHit =
      snap.signal === "hold" ? undefined : snap.signal === "yes" ? y === 1 : y === 0;
    const sideHit = snap.fair === snap.mid ? y === (snap.mid >= 0.5 ? 1 : 0) : snap.fair > snap.mid ? y === 1 : y === 0;
    const leadSec = snapLeadSec(snap.closeTime, snap.snappedAt);
    const marketBrier = brier(snap.mid, y);
    const modelBrier = brier(snap.fair, y);
    const informative = isInformativeSnap(snap.mid, snap.closeTime, snap.snappedAt);
    out.push({
      ...snap,
      result: v.result,
      y,
      brier: modelBrier,
      marketBrier,
      skill: marketBrier - modelBrier,
      leadSec,
      informative,
      grokBrier: snap.grok != null ? brier(snap.grok, y) : undefined,
      signalHit,
      sideHit,
    });
  }
  out.sort((a, b) => Date.parse(b.closeTime) - Date.parse(a.closeTime));
  return out;
}

export type Bin = {
  lo: number;
  hi: number;
  n: number;
  avgFair: number;
  freq: number;
};

export type CalSummary = {
  n: number;
  brier: number;
  marketBrier: number;
  skill: number;
  honestN: number;
  honestBrier: number;
  honestMarketBrier: number;
  honestSkill: number;
  grokN: number;
  grokBrier: number;
  signalN: number;
  signalHits: number;
  sideN: number;
  sideHits: number;
  fifteenN: number;
  fifteenBrier: number;
  bins: Bin[];
};

export function summarize(rows: ScoredRow[]): CalSummary {
  const n = rows.length;
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  const honest = rows.filter((r) => r.informative);
  const signals = honest.filter((r) => r.signalHit !== undefined);
  const fifteen = honest.filter((r) => isFifteenCrypto(r.seriesTicker));
  const grok = honest.filter((r) => r.grokBrier != null);
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const bins: Bin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = honest.filter((r) => r.fair >= lo && r.fair < hi);
    const avgFair = mean(inBin.map((r) => r.fair));
    const freq = mean(inBin.map((r) => r.y));
    bins.push({ lo, hi: i === edges.length - 2 ? 1 : hi, n: inBin.length, avgFair, freq });
  }
  return {
    n,
    brier: mean(rows.map((r) => r.brier)),
    marketBrier: mean(rows.map((r) => r.marketBrier)),
    skill: mean(rows.map((r) => r.skill)),
    honestN: honest.length,
    honestBrier: mean(honest.map((r) => r.brier)),
    honestMarketBrier: mean(honest.map((r) => r.marketBrier)),
    honestSkill: mean(honest.map((r) => r.skill)),
    grokN: grok.length,
    grokBrier: mean(grok.map((r) => r.grokBrier ?? 0)),
    signalN: signals.length,
    signalHits: signals.filter((r) => r.signalHit).length,
    sideN: honest.length,
    sideHits: honest.filter((r) => r.sideHit).length,
    fifteenN: fifteen.length,
    fifteenBrier: mean(fifteen.map((r) => r.brier)),
    bins,
  };
}

export function collectDeskSnaps(
  data: DeskResponse,
  watch: string[],
  openTickers: string[],
  grokByTicker: Record<string, { probability?: number } | undefined>,
): QuoteSnap[] {
  const want = new Set<string>([
    ...watch,
    ...openTickers,
    ...(data.btc?.rungs.map((r) => r.ticker) ?? []),
    ...(data.eth?.rungs.map((r) => r.ticker) ?? []),
    ...(data.gold?.rungs.map((r) => r.ticker) ?? []),
  ]);
  const rows: QuoteSnap[] = [];
  const seen = new Set<string>();
  const push = (row: QuoteSnap) => {
    if (seen.has(row.ticker)) return;
    seen.add(row.ticker);
    rows.push(row);
  };
  if (data.btc15) push(snapFifteen(data.btc15, grokByTicker[data.btc15.ticker]?.probability));
  if (data.eth15) push(snapFifteen(data.eth15, grokByTicker[data.eth15.ticker]?.probability));
  if (data.gold15) push(snapFifteen(data.gold15, grokByTicker[data.gold15.ticker]?.probability));
  for (const m of data.markets) {
    if (m.signal === "hold" && !want.has(m.ticker) && !isPrintMarket(m.seriesTicker)) {
      continue;
    }
    push(snapMarket(m, grokByTicker[m.ticker]?.probability));
  }
  return rows;
}

function snapMarket(m: DeskMarket, grok?: number): QuoteSnap {
  return {
    ticker: m.ticker,
    eventTicker: m.eventTicker,
    seriesTicker: m.seriesTicker,
    title: m.yesSubTitle || m.title,
    eventTitle: m.eventTitle,
    category: m.category,
    closeTime: m.closeTime,
    target: m.strike,
    mid: m.mid,
    fair: m.fair,
    bid: m.bid,
    ask: m.ask,
    signal: m.signal,
    grok,
    snappedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
  };
}

function snapFifteen(p: CryptoFifteen, grok?: number): QuoteSnap {
  const seriesTicker =
    p.asset === "eth" ? "KXETH15M" : p.asset === "gold" ? "KXGOLD15M" : "KXBTC15M";
  return {
    ticker: p.ticker,
    eventTicker: p.ticker,
    seriesTicker,
    title: p.title,
    eventTitle: p.eventTitle,
    category: "Commodities",
    closeTime: p.closeTime,
    target: p.target,
    mid: p.mid,
    fair: p.fair,
    bid: p.bid,
    ask: p.ask,
    signal: p.signal,
    grok,
    snappedAt: new Date().toISOString(),
    modelVersion: MODEL_VERSION,
  };
}

function persistBase(s: { hydrated: boolean; snaps: Record<string, QuoteSnap>; verdicts: Record<string, Verdict> }) {
  if (s.hydrated) return s;
  const disk = read();
  return {
    snaps: disk.snaps,
    verdicts: disk.verdicts,
  };
}

export type SeriesGroup = {
  key: string;
  label: string;
  /** Distinguish one mutually-exclusive event (one ladder) from independent markets. */
  isLadder: boolean;
};

export function seriesGroupKey(seriesTicker: string): string {
  const s = seriesTicker.toUpperCase();
  if (s === "KXBTC15M") return "btc-15m";
  if (s === "KXETH15M") return "eth-15m";
  if (s === "KXBTCD" || s === "KXBTC") return "btc-hourly";
  if (s === "KXETHD" || s === "KXETH") return "eth-hourly";
  if (s === "KXGOLD15M") return "gold-15m";
  if (s === "KXGOLDH") return "gold-hourly";
  if (s.startsWith("KXBTC")) return "btc-other";
  if (s.startsWith("KXETH")) return "eth-other";
  if (s.startsWith("KXGOLD")) return "gold-other";
  return "other";
}

export function seriesGroup(seriesTicker: string): SeriesGroup {
  const key = seriesGroupKey(seriesTicker);
  switch (key) {
    case "btc-15m":
      return { key, label: "BTC 15m", isLadder: false };
    case "eth-15m":
      return { key, label: "ETH 15m", isLadder: false };
    case "gold-15m":
      return { key, label: "Gold 15m", isLadder: false };
    case "btc-hourly":
      return { key, label: "BTC hourly ladder", isLadder: true };
    case "eth-hourly":
      return { key, label: "ETH hourly ladder", isLadder: true };
    case "gold-hourly":
      return { key, label: "Gold hourly ladder", isLadder: true };
    case "btc-other":
      return { key, label: "BTC other", isLadder: false };
    case "eth-other":
      return { key, label: "ETH other", isLadder: false };
    case "gold-other":
      return { key, label: "Gold other", isLadder: false };
    default:
      return { key, label: "Other", isLadder: false };
  }
}

export type SeriesBreakdown = {
  key: string;
  label: string;
  isLadder: boolean;
  n: number;
  honestN: number;
  events: number;
  honestEvents: number;
  honestBrier: number;
  honestMarketBrier: number;
  honestSkill: number;
};

/** Honest per-series-group breakdown. Ladder rungs share one event. */
export function summarizeBySeries(rows: ScoredRow[]): SeriesBreakdown[] {
  const groups = new Map<string, ScoredRow[]>();
  for (const r of rows) {
    const key = seriesGroupKey(r.seriesTicker);
    const list = groups.get(key) ?? [];
    list.push(r);
    groups.set(key, list);
  }
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  const out: SeriesBreakdown[] = [];
  for (const [key, list] of groups) {
    const g = seriesGroup(key);
    const honest = list.filter((r) => r.informative);
    out.push({
      ...g,
      n: list.length,
      honestN: honest.length,
      events: new Set(list.map((r) => r.eventTicker)).size,
      honestEvents: new Set(honest.map((r) => r.eventTicker)).size,
      honestBrier: mean(honest.map((r) => r.brier)),
      honestMarketBrier: mean(honest.map((r) => r.marketBrier)),
      honestSkill: mean(honest.map((r) => r.skill)),
    });
  }
  return out.sort((a, b) => b.honestN - a.honestN);
}

export type HorizonBreakdown = {
  label: string;
  n: number;
  brier: number;
  marketBrier: number;
  skill: number;
};

/** Bucket honest rows by how long before close the snapshot was taken. */
export function summarizeByHorizon(rows: ScoredRow[]): HorizonBreakdown[] {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);
  const buckets: { label: string; lo: number; hi: number }[] = [
    { label: "90s–10m", lo: 90, hi: 600 },
    { label: "10m–1h", lo: 600, hi: 3600 },
    { label: "1h–6h", lo: 3600, hi: 21600 },
    { label: "6h+", lo: 21600, hi: Infinity },
  ];
  const out: HorizonBreakdown[] = [];
  for (const b of buckets) {
    const rowsIn = rows.filter(
      (r) => r.informative && r.leadSec >= b.lo && r.leadSec < b.hi,
    );
    if (rowsIn.length === 0) continue;
    out.push({
      label: b.label,
      n: rowsIn.length,
      brier: mean(rowsIn.map((r) => r.brier)),
      marketBrier: mean(rowsIn.map((r) => r.marketBrier)),
      skill: mean(rowsIn.map((r) => r.skill)),
    });
  }
  return out;
}

export function pendingTickers(
  snaps: Record<string, QuoteSnap>,
  verdicts: Record<string, Verdict>,
  now = Date.now(),
): string[] {
  const out: string[] = [];
  for (const s of Object.values(snaps)) {
    if (verdicts[s.ticker]) continue;
    const close = Date.parse(s.closeTime);
    if (!Number.isFinite(close) || close > now - 20_000) continue;
    out.push(s.ticker);
  }
  return out;
}

export const useCalibration = create<CalState>((set, get) => ({
  snaps: {},
  verdicts: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ ...read(), hydrated: true });
  },
  capture: (rows) => {
    if (rows.length === 0) return;
    set((s) => {
      const base = persistBase(s);
      const snaps = { ...base.snaps };
      const now = Date.now();
      for (const row of rows) {
        if (base.verdicts[row.ticker]) continue;
        const close = Date.parse(row.closeTime);
        if (Number.isFinite(close) && now >= close) continue;
        snaps[row.ticker] = mergeLiveSnap(snaps[row.ticker], row);
      }
      const next = prune(snaps, base.verdicts);
      write(next);
      return { ...next, hydrated: true };
    });
  },
  applyVerdicts: (rows) => {
    if (rows.length === 0) return;
    set((s) => {
      const base = persistBase(s);
      const verdicts = { ...base.verdicts };
      let changed = false;
      for (const row of rows) {
        if (verdicts[row.ticker]) continue;
        if (row.result !== "yes" && row.result !== "no") continue;
        verdicts[row.ticker] = {
          ticker: row.ticker,
          result: row.result,
          resolvedAt: new Date().toISOString(),
        };
        changed = true;
      }
      if (!changed) return s;
      const next = prune(base.snaps, verdicts);
      write(next);
      return { ...next, hydrated: true };
    });
  },
}));
