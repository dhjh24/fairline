import { create } from "zustand";

const KEY = "fairline-blotter-v1";
export const STARTING_CASH = 1_000;

export type LotSide = "yes" | "no";
export type CloseReason = "flatten" | "settle-yes" | "settle-no" | "void";

export type LotSource = "manual" | "bot";

export type BlotterLot = {
  id: string;
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  title: string;
  eventTitle: string;
  category: string;
  closeTime: string;
  side: LotSide;
  contracts: number;
  fillPrice: number;
  fairAtEntry: number;
  midAtEntry: number;
  openedAt: string;
  status: "open" | "closed";
  closedAt?: string;
  exitPrice?: number;
  closeReason?: CloseReason;
  source?: LotSource;
};

export type TickerMark = {
  ticker: string;
  mid: number;
  fair: number;
};

export type OpenIntent = {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  title: string;
  eventTitle: string;
  category: string;
  closeTime: string;
  side: LotSide;
  contracts: number;
  fillPrice: number;
  fairAtEntry: number;
  midAtEntry: number;
  source?: LotSource;
};

type Persisted = {
  lots: BlotterLot[];
  marks: Record<string, TickerMark>;
};

type BlotterState = Persisted & {
  hydrated: boolean;
  hydrate: () => void;
  openLot: (intent: OpenIntent) => { ok: true; lot: BlotterLot } | { ok: false; error: string };
  closeLot: (id: string, reason: CloseReason, exitPrice: number) => void;
  voidLot: (id: string) => void;
  applyMarks: (quotes: TickerMark[]) => void;
  settleLots: (rows: { ticker: string; result: "yes" | "no" }[]) => void;
  reset: () => void;
};

function read(): Persisted {
  if (typeof window === "undefined") return { lots: [], marks: {} };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { lots: [], marks: {} };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const lots = Array.isArray(parsed.lots) ? parsed.lots.filter(isLot) : [];
    const marks =
      parsed.marks && typeof parsed.marks === "object" && !Array.isArray(parsed.marks)
        ? parsed.marks
        : {};
    return { lots, marks };
  } catch {
    return { lots: [], marks: {} };
  }
}

function isLot(v: unknown): v is BlotterLot {
  if (!v || typeof v !== "object") return false;
  const l = v as BlotterLot;
  return (
    typeof l.id === "string" &&
    typeof l.ticker === "string" &&
    (l.side === "yes" || l.side === "no") &&
    typeof l.contracts === "number" &&
    typeof l.fillPrice === "number"
  );
}

function write(state: Persisted) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify({ lots: state.lots, marks: state.marks }));
}

export function sideMark(side: LotSide, yesPrice: number): number {
  return side === "yes" ? yesPrice : 1 - yesPrice;
}

export function lotCost(lot: BlotterLot): number {
  return lot.fillPrice * lot.contracts;
}

export function lotPnl(lot: BlotterLot, yesPrice: number): number {
  if (lot.status === "closed") {
    if (lot.closeReason === "void" || lot.exitPrice == null) return 0;
    return (lot.exitPrice - lot.fillPrice) * lot.contracts;
  }
  return (sideMark(lot.side, yesPrice) - lot.fillPrice) * lot.contracts;
}

export function cashOnHand(lots: BlotterLot[]): number {
  let cash = STARTING_CASH;
  for (const lot of lots) {
    if (lot.closeReason === "void") continue;
    cash -= lotCost(lot);
    if (lot.status === "closed" && lot.exitPrice != null) {
      cash += lot.exitPrice * lot.contracts;
    }
  }
  return cash;
}

export type BlotterTotals = {
  cash: number;
  openCost: number;
  openMarketValue: number;
  openModelValue: number;
  unrealizedMarket: number;
  unrealizedModel: number;
  realized: number;
  equityMarket: number;
  equityModel: number;
  openCount: number;
  closedCount: number;
};

export function blotterTotals(
  lots: BlotterLot[],
  marks: Record<string, TickerMark>,
): BlotterTotals {
  let openCost = 0;
  let openMarketValue = 0;
  let openModelValue = 0;
  let unrealizedMarket = 0;
  let unrealizedModel = 0;
  let realized = 0;
  let openCount = 0;
  let closedCount = 0;

  for (const lot of lots) {
    if (lot.closeReason === "void") continue;
    if (lot.status === "closed") {
      closedCount += 1;
      realized += lotPnl(lot, 0);
      continue;
    }
    openCount += 1;
    openCost += lotCost(lot);
    const mark = marks[lot.ticker];
    const mid = mark?.mid ?? lot.midAtEntry;
    const fair = mark?.fair ?? lot.fairAtEntry;
    openMarketValue += sideMark(lot.side, mid) * lot.contracts;
    openModelValue += sideMark(lot.side, fair) * lot.contracts;
    unrealizedMarket += lotPnl(lot, mid);
    unrealizedModel += lotPnl(lot, fair);
  }

  const cash = cashOnHand(lots);
  return {
    cash,
    openCost,
    openMarketValue,
    openModelValue,
    unrealizedMarket,
    unrealizedModel,
    realized,
    equityMarket: cash + openMarketValue,
    equityModel: cash + openModelValue,
    openCount,
    closedCount,
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `lot_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const useBlotter = create<BlotterState>((set, get) => ({
  lots: [],
  marks: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const persisted = read();
    set({ ...persisted, hydrated: true });
  },
  openLot: (intent) => {
    const snap = get().hydrated ? { lots: get().lots, marks: get().marks } : read();
    if (!get().hydrated) set({ ...snap, hydrated: true });
    const n = Math.floor(intent.contracts);
    if (!Number.isFinite(n) || n < 1) return { ok: false, error: "Need at least one contract." };
    if (!Number.isFinite(intent.fillPrice) || intent.fillPrice <= 0.004 || intent.fillPrice >= 0.996) {
      return { ok: false, error: "Fill price is off the board." };
    }
    const cost = n * intent.fillPrice;
    const cash = cashOnHand(snap.lots);
    if (cost > cash + 1e-9) {
      return { ok: false, error: `Need $${cost.toFixed(2)} paper cash; ${cash.toFixed(2)} left.` };
    }
    const lot: BlotterLot = {
      id: newId(),
      ticker: intent.ticker,
      eventTicker: intent.eventTicker,
      seriesTicker: intent.seriesTicker,
      title: intent.title,
      eventTitle: intent.eventTitle,
      category: intent.category,
      closeTime: intent.closeTime,
      side: intent.side,
      contracts: n,
      fillPrice: intent.fillPrice,
      fairAtEntry: intent.fairAtEntry,
      midAtEntry: intent.midAtEntry,
      openedAt: new Date().toISOString(),
      status: "open",
      source: intent.source ?? "manual",
    };
    set((s) => {
      const lots = s.hydrated ? s.lots : snap.lots;
      const next = { lots: [lot, ...lots], marks: s.hydrated ? s.marks : snap.marks };
      write(next);
      return { ...next, hydrated: true };
    });
    return { ok: true, lot };
  },
  closeLot: (id, reason, exitPrice) => {
    const px = Math.min(0.999, Math.max(0, exitPrice));
    set((s) => {
      const base = s.hydrated ? s : read();
      const lots = base.lots.map((lot) =>
        lot.id === id && lot.status === "open"
          ? {
              ...lot,
              status: "closed" as const,
              closedAt: new Date().toISOString(),
              exitPrice: reason === "void" ? lot.fillPrice : px,
              closeReason: reason,
            }
          : lot,
      );
      const next = { lots, marks: base.marks };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  voidLot: (id) => {
    set((s) => {
      const base = s.hydrated ? s : read();
      const lots = base.lots.map((lot) =>
        lot.id === id
          ? {
              ...lot,
              status: "closed" as const,
              closedAt: new Date().toISOString(),
              exitPrice: lot.fillPrice,
              closeReason: "void" as const,
            }
          : lot,
      );
      const next = { lots, marks: base.marks };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  applyMarks: (quotes) => {
    if (quotes.length === 0) return;
    set((s) => {
      const base = s.hydrated ? s : read();
      const marks = { ...base.marks };
      let changed = false;
      for (const q of quotes) {
        const prev = marks[q.ticker];
        if (!prev || prev.mid !== q.mid || prev.fair !== q.fair) {
          marks[q.ticker] = { ticker: q.ticker, mid: q.mid, fair: q.fair };
          changed = true;
        }
      }
      if (!changed && s.hydrated) return s;
      const next = { lots: base.lots, marks };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  settleLots: (rows) => {
    if (rows.length === 0) return;
    const byTicker = new Map(rows.map((r) => [r.ticker, r.result]));
    set((s) => {
      const base = s.hydrated ? s : read();
      let changed = false;
      const lots = base.lots.map((lot) => {
        if (lot.status !== "open") return lot;
        const result = byTicker.get(lot.ticker);
        if (!result) return lot;
        const y = result === "yes" ? 1 : 0;
        const exitPrice = lot.side === "yes" ? y : 1 - y;
        changed = true;
        return {
          ...lot,
          status: "closed" as const,
          closedAt: new Date().toISOString(),
          exitPrice,
          closeReason: (result === "yes" ? "settle-yes" : "settle-no") as CloseReason,
        };
      });
      if (!changed && s.hydrated) return s;
      const next = { lots, marks: base.marks };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  reset: () => {
    const next = { lots: [] as BlotterLot[], marks: {} as Record<string, TickerMark> };
    write(next);
    set({ ...next, hydrated: true });
  },
}));
