import { create } from "zustand";
import { isFifteenCrypto } from "@/lib/crypto";
import type { Signal } from "@/lib/types";

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
    out.push({
      ...snap,
      result: v.result,
      y,
      brier: brier(snap.fair, y),
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
  const signals = rows.filter((r) => r.signalHit !== undefined);
  const fifteen = rows.filter((r) => isFifteenCrypto(r.seriesTicker));
  const grok = rows.filter((r) => r.grokBrier != null);
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1.0001];
  const bins: Bin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = edges[i]!;
    const hi = edges[i + 1]!;
    const inBin = rows.filter((r) => r.fair >= lo && r.fair < hi);
    const avgFair = mean(inBin.map((r) => r.fair));
    const freq = mean(inBin.map((r) => r.y));
    bins.push({ lo, hi: i === edges.length - 2 ? 1 : hi, n: inBin.length, avgFair, freq });
  }
  return {
    n,
    brier: mean(rows.map((r) => r.brier)),
    grokN: grok.length,
    grokBrier: mean(grok.map((r) => r.grokBrier ?? 0)),
    signalN: signals.length,
    signalHits: signals.filter((r) => r.signalHit).length,
    sideN: n,
    sideHits: rows.filter((r) => r.sideHit).length,
    fifteenN: fifteen.length,
    fifteenBrier: mean(fifteen.map((r) => r.brier)),
    bins,
  };
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
      const snaps = { ...s.snaps };
      const now = Date.now();
      for (const row of rows) {
        if (s.verdicts[row.ticker]) continue;
        const close = Date.parse(row.closeTime);
        if (Number.isFinite(close) && now >= close) continue;
        snaps[row.ticker] = row;
      }
      const next = prune(snaps, s.verdicts);
      write(next);
      return { ...next, hydrated: true };
    });
  },
  applyVerdicts: (rows) => {
    if (rows.length === 0) return;
    set((s) => {
      const verdicts = { ...s.verdicts };
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
      const next = prune(s.snaps, verdicts);
      write(next);
      return { ...next, hydrated: true };
    });
  },
}));
