import { create } from "zustand";
import { FEE_POLICY_ID, takerFeeUsd } from "./fees.ts";
import { dayKey, loadRiskSettings, riskVeto, type RiskPortfolio } from "./risk.ts";

const KEY = "fairline-blotter-v1";
const STORAGE_SCHEMA = 2;
export const STARTING_CASH = 1_000;

export type LotSide = "yes" | "no";
export type CloseReason = "flatten" | "settle-yes" | "settle-no" | "void";

export type LotSource = "manual" | "bot";

/** Who confirmed the outcome. Exchange = Kalshi `result` (auto-settle); manual = user dialog. */
export type SettleProvenance = "exchange" | "manual";

/** The quote side a paper exit executed against. */
export type ExitBasis = "bid" | "ask" | "settle" | "manual" | "void";

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
  /** Fee policy at fill time — the same Kalshi taker schedule is assumed for every paper fill. */
  feePolicy?: string;
  /** Estimated taker fee (USD) for this ticket, from `fees.ts`. */
  feeUsd?: number;
  /** Who confirmed the settlement: exchange result poll, or manual dialog. */
  settleProvenance?: SettleProvenance;
  /** Which executable quote side the exit used (bid / ask for flatten). */
  exitBasis?: ExitBasis;
};

export type TickerMark = {
  ticker: string;
  mid: number;
  fair: number;
  bid?: number;
  ask?: number;
  last?: number;
  asOf?: string;
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
  schema: number;
  lots: BlotterLot[];
  marks: Record<string, TickerMark>;
};

type BlotterState = Persisted & {
  hydrated: boolean;
  hydrate: () => void;
  openLot: (intent: OpenIntent) => { ok: true; lot: BlotterLot } | { ok: false; error: string };
  closeLot: (
    id: string,
    reason: CloseReason,
    exitPrice: number,
    opts?: { settleProvenance?: SettleProvenance; exitBasis?: ExitBasis },
  ) => void;
  voidLot: (id: string) => void;
  applyMarks: (quotes: TickerMark[]) => void;
  settleLots: (rows: { ticker: string; result: "yes" | "no" }[]) => void;
  importBook: (json: string) => { ok: true; lots: number } | { ok: false; error: string };
  reset: () => void;
};

const EMPTY: Persisted = { schema: STORAGE_SCHEMA, lots: [], marks: {} };

function read(): Persisted {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    const lots = Array.isArray(parsed.lots)
      ? parsed.lots.map(migrateLot).filter(isLot)
      : [];
    const marks =
      parsed.marks && typeof parsed.marks === "object" && !Array.isArray(parsed.marks)
        ? parsed.marks
        : {};
    return { schema: STORAGE_SCHEMA, lots, marks };
  } catch {
    return { ...EMPTY };
  }
}

/** Additive migration for persisted lots (older fills predate fee tracking). */
function migrateLot(v: unknown): unknown {
  if (!v || typeof v !== "object") return v;
  const l = v as Record<string, unknown>;
  if (typeof l.feePolicy === "undefined") l.feePolicy = "pre-fee-tracking";
  if (typeof l.feeUsd === "undefined") l.feeUsd = 0;
  if (typeof l.settleProvenance === "undefined") l.settleProvenance = "manual";
  return l;
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
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function sideMark(side: LotSide, yesPrice: number): number {
  return side === "yes" ? yesPrice : 1 - yesPrice;
}

/** Premium cost (fill price × contracts), excluding fee — used for per-unit display. */
export function lotCost(lot: BlotterLot): number {
  return lot.fillPrice * lot.contracts;
}

/** Total entry cost: premium + the estimated Kalshi taker fee at fill time. */
export function lotEntryCost(lot: BlotterLot): number {
  return lotCost(lot) + (lot.feeUsd ?? 0);
}

/**
 * Net P&L for a lot given the current YES price. Closed lots use their exit
 * price; open lots mark to `yesPrice`. Fees paid at entry are deducted, so a
 * breakeven fill at the exact fee-free price still shows the fee as a loss.
 */
export function lotPnl(lot: BlotterLot, yesPrice: number): number {
  if (lot.status === "closed") {
    if (lot.closeReason === "void" || lot.exitPrice == null) return 0;
    return lot.exitPrice * lot.contracts - lotEntryCost(lot);
  }
  return sideMark(lot.side, yesPrice) * lot.contracts - lotEntryCost(lot);
}

export function cashOnHand(lots: BlotterLot[]): number {
  let cash = STARTING_CASH;
  for (const lot of lots) {
    if (lot.closeReason === "void") continue;
    cash -= lotEntryCost(lot);
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
  /** Estimated taker fees paid so far on all non-void fills. */
  feesPaid: number;
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
  let feesPaid = 0;
  let openCount = 0;
  let closedCount = 0;

  for (const lot of lots) {
    if (lot.closeReason === "void") continue;
    feesPaid += lot.feeUsd ?? 0;
    if (lot.status === "closed") {
      closedCount += 1;
      realized += lotPnl(lot, 0);
      continue;
    }
    openCount += 1;
    openCost += lotEntryCost(lot);
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
    feesPaid,
  };
}

/**
 * Aggregates for the risk veto. Open positions count together (manual + bot);
 * event exposure is per event ticker. `dayLoss` is today's net realized P&L
 * (UTC day, exchange + manual settlements, voids excluded) plus today's open
 * unrealized market P&L, so a fast adverse tape cannot front-run the limit.
 */
export function portfolioForRisk(
  lots: BlotterLot[],
  marks: Record<string, TickerMark>,
  now = Date.now(),
): RiskPortfolio {
  const today = dayKey(now);
  let openCost = 0;
  let openCount = 0;
  let dayLoss = 0;
  let lastOpenAt = 0;
  const eventCosts = new Map<string, number>();
  let eventOpenCost = 0;

  for (const lot of lots) {
    if (lot.closeReason === "void") continue;
    const opened = Date.parse(lot.openedAt);
    if (Number.isFinite(opened) && opened > lastOpenAt) lastOpenAt = opened;
    if (lot.status === "open") {
      openCount += 1;
      const entry = lotEntryCost(lot);
      openCost += entry;
      eventCosts.set(lot.eventTicker, (eventCosts.get(lot.eventTicker) ?? 0) + entry);
      const mid = marks[lot.ticker]?.mid ?? lot.midAtEntry;
      dayLoss += lotPnl(lot, mid);
    } else if (lot.closedAt && dayKey(Date.parse(lot.closedAt)) === today) {
      dayLoss += lotPnl(lot, 0);
    }
  }
  eventOpenCost = [...eventCosts.values()].reduce((s, v) => Math.max(s, v), 0);

  return {
    cash: cashOnHand(lots),
    openCost,
    openCount,
    eventOpenCost,
    dayLoss,
    lastOpenAt,
  };
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `lot_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export const useBlotter = create<BlotterState>((set, get) => ({
  schema: STORAGE_SCHEMA,
  lots: [],
  marks: {},
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    const persisted = read();
    set({ ...persisted, hydrated: true });
  },
  openLot: (intent) => {
    const snap = get().hydrated
      ? { schema: get().schema, lots: get().lots, marks: get().marks }
      : read();
    if (!get().hydrated) set({ ...snap, hydrated: true });
    const n = Math.floor(intent.contracts);
    if (!Number.isFinite(n) || n < 1) return { ok: false, error: "Need at least one contract." };
    if (!Number.isFinite(intent.fillPrice) || intent.fillPrice <= 0.004 || intent.fillPrice >= 0.996) {
      return { ok: false, error: "Fill price is off the board." };
    }
    const feeUsd = takerFeeUsd(n, intent.fillPrice);
    const cost = n * intent.fillPrice + feeUsd;
    const cash = cashOnHand(snap.lots);

    const veto = riskVeto({
      settings: loadRiskSettings(),
      portfolio: portfolioForRisk(snap.lots, snap.marks),
      ticketCost: cost,
      eventTicker: intent.eventTicker,
    });
    if (veto) return { ok: false, error: veto.message };

    if (cost > cash + 1e-9) {
      return { ok: false, error: `Need $${cost.toFixed(2)} paper cash (incl. ~$${feeUsd.toFixed(2)} fee); ${cash.toFixed(2)} left.` };
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
      feePolicy: FEE_POLICY_ID,
      feeUsd,
      settleProvenance: undefined,
      exitBasis: undefined,
    };
    set((s) => {
      const lots = s.hydrated ? s.lots : snap.lots;
      const next = { schema: STORAGE_SCHEMA, lots: [lot, ...lots], marks: s.hydrated ? s.marks : snap.marks };
      write(next);
      return { ...next, hydrated: true };
    });
    return { ok: true, lot };
  },
  closeLot: (id, reason, exitPrice, opts) => {
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
              settleProvenance: opts?.settleProvenance ?? (reason === "flatten" ? "manual" : lot.settleProvenance),
              exitBasis: opts?.exitBasis ?? (reason === "void" ? "void" : "manual"),
            }
          : lot,
      );
      const next = { schema: STORAGE_SCHEMA, lots, marks: base.marks };
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
              settleProvenance: "manual" as const,
              exitBasis: "void" as const,
            }
          : lot,
      );
      const next = { schema: STORAGE_SCHEMA, lots, marks: base.marks };
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
        if (
          !prev ||
          prev.mid !== q.mid ||
          prev.fair !== q.fair ||
          prev.bid !== q.bid ||
          prev.ask !== q.ask
        ) {
          marks[q.ticker] = {
            ticker: q.ticker,
            mid: q.mid,
            fair: q.fair,
            bid: q.bid,
            ask: q.ask,
            last: q.last,
            asOf: q.asOf,
          };
          changed = true;
        }
      }
      if (!changed && s.hydrated) return s;
      const next = { schema: STORAGE_SCHEMA, lots: base.lots, marks };
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
          settleProvenance: "exchange" as const,
          exitBasis: "settle" as const,
        };
      });
      if (!changed && s.hydrated) return s;
      const next = { schema: STORAGE_SCHEMA, lots, marks: base.marks };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  importBook: (json) => {
    try {
      const parsed = JSON.parse(json) as {
        schema?: number;
        lots?: unknown[];
        marks?: Record<string, unknown>;
      };
      const lotsRaw = Array.isArray(parsed.lots) ? parsed.lots.map(migrateLot).filter(isLot) : [];
      const marks: Record<string, TickerMark> = {};
      if (parsed.marks && typeof parsed.marks === "object") {
        for (const [ticker, m] of Object.entries(parsed.marks)) {
          const mm = m as Partial<TickerMark>;
          if (mm && typeof mm.ticker === "string" && typeof mm.mid === "number" && typeof mm.fair === "number") {
            marks[ticker] = {
              ticker: mm.ticker,
              mid: mm.mid,
              fair: mm.fair,
              bid: typeof mm.bid === "number" ? mm.bid : undefined,
              ask: typeof mm.ask === "number" ? mm.ask : undefined,
              last: typeof mm.last === "number" ? mm.last : undefined,
              asOf: typeof mm.asOf === "string" ? mm.asOf : undefined,
            };
          }
        }
      }
      const next = { schema: STORAGE_SCHEMA, lots: lotsRaw, marks };
      write(next);
      set({ ...next, hydrated: true });
      return { ok: true as const, lots: lotsRaw.length };
    } catch {
      return { ok: false, error: "Could not read that file — export a JSON book from Fairline first." };
    }
  },
  reset: () => {
    const next = { schema: STORAGE_SCHEMA, lots: [] as BlotterLot[], marks: {} as Record<string, TickerMark> };
    write(next);
    set({ ...next, hydrated: true });
  },
}));
