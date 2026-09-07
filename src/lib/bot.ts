import { cashOnHand, type BlotterLot, type OpenIntent } from "@/lib/blotter";
import { isFifteenCrypto } from "@/lib/crypto";
import type { DeskMarket } from "@/lib/types";
import { create } from "zustand";

const KEY = "fairline-bot-v1";

export type BotUniverse = "fifteen" | "fast" | "signals";

export type BotFillLog = {
  ticker: string;
  title: string;
  side: "yes" | "no";
  contracts: number;
  fillPrice: number;
  at: string;
};

export type BotSettings = {
  on: boolean;
  universe: BotUniverse;
  lastNote: string;
  lastAt: string;
  sessionFills: number;
  lastFills: BotFillLog[];
};

type BotState = BotSettings & {
  hydrated: boolean;
  hydrate: () => void;
  setOn: (on: boolean) => void;
  setUniverse: (universe: BotUniverse) => void;
  watching: (text: string) => void;
  filled: (rows: BotFillLog[]) => void;
};

const DEFAULTS: BotSettings = {
  on: false,
  universe: "fifteen",
  lastNote: "",
  lastAt: "",
  sessionFills: 0,
  lastFills: [],
};

function readFills(v: unknown): BotFillLog[] {
  if (!Array.isArray(v)) return [];
  const out: BotFillLog[] = [];
  for (const row of v) {
    if (!row || typeof row !== "object") continue;
    const r = row as BotFillLog;
    if (typeof r.ticker !== "string") continue;
    if (r.side !== "yes" && r.side !== "no") continue;
    out.push({
      ticker: r.ticker,
      title: typeof r.title === "string" ? r.title : r.ticker,
      side: r.side,
      contracts: typeof r.contracts === "number" ? r.contracts : 0,
      fillPrice: typeof r.fillPrice === "number" ? r.fillPrice : 0,
      at: typeof r.at === "string" ? r.at : "",
    });
  }
  return out.slice(0, 8);
}

function read(): BotSettings {
  if (typeof window === "undefined") return { ...DEFAULTS };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const p = JSON.parse(raw) as Partial<BotSettings>;
    return {
      on: Boolean(p.on),
      universe: p.universe === "fast" || p.universe === "signals" ? p.universe : "fifteen",
      lastNote: typeof p.lastNote === "string" ? p.lastNote : "",
      lastAt: typeof p.lastAt === "string" ? p.lastAt : "",
      sessionFills: typeof p.sessionFills === "number" ? p.sessionFills : 0,
      lastFills: readFills(p.lastFills),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(s: BotSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
}

function snapshot(s: BotSettings, patch: Partial<BotSettings>): BotSettings {
  const next: BotSettings = {
    on: s.on,
    universe: s.universe,
    lastNote: s.lastNote,
    sessionFills: s.sessionFills,
    lastFills: s.lastFills,
    ...patch,
    lastAt: new Date().toISOString(),
  };
  write(next);
  return next;
}

export const MAX_OPEN_BOT = 12;
export const MAX_FILLS_PER_TICK = 4;
const MIN_CASH = 5;
const MAX_SHARE = 0.1;
const MAX_CONTRACTS = 40;

export function inUniverse(m: DeskMarket, universe: BotUniverse, now = Date.now()): boolean {
  if (m.signal !== "yes" && m.signal !== "no") return false;
  if (universe === "fifteen") return isFifteenCrypto(m.seriesTicker);
  if (universe === "fast") {
    const close = Date.parse(m.closeTime);
    if (!Number.isFinite(close) || close - now > 6 * 3_600_000) return false;
    return true;
  }
  return true;
}

export function sizeBotTicket(m: DeskMarket, cash: number): { contracts: number; fillPrice: number; side: "yes" | "no" } | null {
  const side = m.signal === "no" ? "no" : "yes";
  const fillPrice = side === "yes" ? m.ask : 1 - m.bid;
  if (!Number.isFinite(fillPrice) || fillPrice <= 0.02 || fillPrice >= 0.98) return null;
  const kelly = side === "yes" ? m.kellyYes : m.kellyNo;
  if (kelly <= 0) return null;
  const risk = Math.min(cash * kelly * 0.5, cash * MAX_SHARE);
  const n = Math.floor(risk / fillPrice);
  if (n < 1 || n * fillPrice < 1) return null;
  return { side, fillPrice, contracts: Math.min(MAX_CONTRACTS, n) };
}

export function proposeBotFills(
  markets: DeskMarket[],
  lots: BlotterLot[],
  universe: BotUniverse,
  now = Date.now(),
): OpenIntent[] {
  const cash = cashOnHand(lots);
  if (cash < MIN_CASH) return [];
  const openBot = lots.filter((l) => l.status === "open" && l.source === "bot");
  const openTickers = new Set(lots.filter((l) => l.status === "open").map((l) => l.ticker));
  let slots = Math.max(0, MAX_OPEN_BOT - openBot.length);
  if (slots === 0) return [];

  const ranked = markets
    .filter((m) => inUniverse(m, universe, now))
    .filter((m) => {
      if (openTickers.has(m.ticker)) return false;
      const close = Date.parse(m.closeTime);
      if (!Number.isFinite(close) || close - now < 45_000) return false;
      return true;
    })
    .sort((a, b) => b.score - a.score);

  const out: OpenIntent[] = [];
  let remaining = cash;
  for (const m of ranked) {
    if (out.length >= MAX_FILLS_PER_TICK || slots <= 0) break;
    const sized = sizeBotTicket(m, remaining);
    if (!sized) continue;
    const cost = sized.contracts * sized.fillPrice;
    if (cost > remaining + 1e-9) continue;
    remaining -= cost;
    slots -= 1;
    out.push({
      ticker: m.ticker,
      eventTicker: m.eventTicker,
      seriesTicker: m.seriesTicker,
      title: m.yesSubTitle || m.title,
      eventTitle: m.eventTitle,
      category: m.category,
      closeTime: m.closeTime,
      side: sized.side,
      contracts: sized.contracts,
      fillPrice: sized.fillPrice,
      fairAtEntry: m.fair,
      midAtEntry: m.mid,
      source: "bot",
    });
  }
  return out;
}

export function botIdleReason(
  markets: DeskMarket[],
  lots: BlotterLot[],
  universe: BotUniverse,
  now = Date.now(),
): string {
  const cash = cashOnHand(lots);
  if (cash < MIN_CASH) {
    return `Not buying — paper cash is $${cash.toFixed(0)}.`;
  }
  const openBot = lots.filter((l) => l.status === "open" && l.source === "bot");
  if (openBot.length >= MAX_OPEN_BOT) {
    return `Not buying — already ${openBot.length} open bot lots. Waiting to settle.`;
  }
  const signals = markets.filter((m) => inUniverse(m, universe, now));
  const label =
    universe === "fifteen"
      ? "15-minute BTC and ETH"
      : universe === "fast"
        ? "books closing within 6 hours"
        : "desk signals";
  if (signals.length === 0) {
    return `ON. Watching ${label}. Fairline says HOLD — not buying.`;
  }
  const openTickers = new Set(lots.filter((l) => l.status === "open").map((l) => l.ticker));
  const leftover = signals.filter((m) => !openTickers.has(m.ticker));
  if (leftover.length === 0) {
    const sides = signals
      .map((m) => `BUY ${m.signal.toUpperCase()}`)
      .filter((v, i, a) => a.indexOf(v) === i)
      .join(" / ");
    return `ON. Already in: ${sides}. Waiting to settle — not doubling.`;
  }
  const live = leftover.filter((m) => {
    const close = Date.parse(m.closeTime);
    return Number.isFinite(close) && close - now >= 45_000;
  });
  if (live.length === 0) {
    return "ON. Signal is inside 45 seconds of close — skipped.";
  }
  if (live.every((m) => !sizeBotTicket(m, cash))) {
    return "ON. Signal is too close to 0¢ or 100¢ to size a ticket.";
  }
  return `ON. Watching ${label}. Next refresh will try a fill.`;
}

export function describeFill(row: { side: "yes" | "no"; contracts: number; fillPrice: number; title: string }): string {
  const px = `${Math.round(row.fillPrice * 100)}¢`;
  return `Bought ${row.side.toUpperCase()} · ${row.contracts} × ${row.title} @ ${px}`;
}

export const useBot = create<BotState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ ...read(), hydrated: true });
  },
  setOn: (on) => {
    set((s) => ({
      ...s,
      ...snapshot(s, {
        on,
        lastNote: on
          ? "ON. Watching for Fairline Buy YES / Buy NO. Paper only — nothing goes to Kalshi."
          : "OFF. Not buying.",
      }),
      hydrated: true,
    }));
  },
  setUniverse: (universe) => {
    set((s) => ({ ...s, ...snapshot(s, { universe }), hydrated: true }));
  },
  watching: (text) => {
    set((s) => {
      if (s.lastNote === text) return s;
      return { ...s, ...snapshot(s, { lastNote: text }), hydrated: true };
    });
  },
  filled: (rows) => {
    if (rows.length === 0) return;
    set((s) => {
      const lastFills = [...rows, ...s.lastFills].slice(0, 8);
      const lastNote = rows.map(describeFill).join(" · ");
      return {
        ...s,
        ...snapshot(s, {
          lastFills,
          lastNote,
          sessionFills: s.sessionFills + rows.length,
        }),
        hydrated: true,
      };
    });
  },
}));
