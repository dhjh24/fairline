import { create } from "zustand";

const KEY = "fairline-watch";

function read(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function write(tickers: string[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(tickers));
}

type WatchState = {
  tickers: string[];
  hydrated: boolean;
  hydrate: () => void;
  toggle: (ticker: string) => void;
  has: (ticker: string) => boolean;
};

export const useWatchlist = create<WatchState>((set, get) => ({
  tickers: [],
  hydrated: false,
  hydrate: () => set({ tickers: read(), hydrated: true }),
  toggle: (ticker) => {
    const cur = get().tickers;
    const next = cur.includes(ticker) ? cur.filter((t) => t !== ticker) : [ticker, ...cur];
    write(next);
    set({ tickers: next, hydrated: true });
  },
  has: (ticker) => get().tickers.includes(ticker),
}));
