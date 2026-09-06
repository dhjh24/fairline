import { create } from "zustand";
import { DEFAULT_PROVIDER_ID, LLM_PROVIDERS } from "@/lib/llm-providers";
import type { GrokFactor } from "@/lib/types";

const KEY = "fairline-forecasts-v1";

export type CachedForecast = {
  ticker: string;
  providerId: string;
  model: string;
  at: string;
  fairAtRun: number;
  midAtRun: number;
  probability: number;
  confidence: number;
  blended: number;
  thesis: string;
  factors: GrokFactor[];
  risks: string[];
};

type Persisted = {
  providerId: string;
  byTicker: Record<string, CachedForecast>;
};

type ForecastState = Persisted & {
  hydrated: boolean;
  running: string[];
  error: string | null;
  hydrate: () => void;
  setProvider: (id: string) => void;
  put: (row: CachedForecast) => void;
  setRunning: (tickers: string[]) => void;
  setError: (error: string | null) => void;
};

function isRow(v: unknown): v is CachedForecast {
  if (!v || typeof v !== "object") return false;
  const r = v as CachedForecast;
  return typeof r.ticker === "string" && typeof r.probability === "number" && typeof r.blended === "number";
}

function read(): Persisted {
  if (typeof window === "undefined") return { providerId: DEFAULT_PROVIDER_ID, byTicker: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { providerId: DEFAULT_PROVIDER_ID, byTicker: {} };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const providerId =
      LLM_PROVIDERS.some((p) => p.id === parsed.providerId) && parsed.providerId
        ? parsed.providerId
        : DEFAULT_PROVIDER_ID;
    const byTicker: Record<string, CachedForecast> = {};
    if (parsed.byTicker && typeof parsed.byTicker === "object") {
      for (const [k, v] of Object.entries(parsed.byTicker)) {
        if (isRow(v)) byTicker[k] = v;
      }
    }
    return { providerId, byTicker };
  } catch {
    return { providerId: DEFAULT_PROVIDER_ID, byTicker: {} };
  }
}

function write(state: Persisted) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export const useForecasts = create<ForecastState>((set, get) => ({
  providerId: DEFAULT_PROVIDER_ID,
  byTicker: {},
  hydrated: false,
  running: [],
  error: null,
  hydrate: () => {
    if (get().hydrated) return;
    set({ ...read(), hydrated: true });
  },
  setProvider: (id) => {
    const providerId = LLM_PROVIDERS.some((p) => p.id === id) ? id : DEFAULT_PROVIDER_ID;
    set((s) => {
      const next = { providerId, byTicker: s.byTicker };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  put: (row) => {
    set((s) => {
      const byTicker = { ...s.byTicker, [row.ticker]: row };
      const next = { providerId: s.providerId, byTicker };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  setRunning: (tickers) => set({ running: tickers }),
  setError: (error) => set({ error }),
}));
