import { cashOnHand, type BlotterLot, type OpenIntent } from "@/lib/blotter";
import { isFifteenCrypto } from "@/lib/crypto";
import type { DeskMarket } from "@/lib/types";
import { create } from "zustand";

const KEY = "fairline-bot-v1";

export type BotUniverse = "fifteen" | "fast" | "signals";

export type BotSettings = {
  on: boolean;
  universe: BotUniverse;
  lastNote: string;
  lastAt: string;
  sessionFills: number;
};

type BotState = BotSettings & {
  hydrated: boolean;
  hydrate: () => void;
  setOn: (on: boolean) => void;
  setUniverse: (universe: BotUniverse) => void;
  note: (text: string, fills?: number) => void;
};

const DEFAULTS: BotSettings = {
  on: false,
  universe: "fifteen",
  lastNote: "",
  lastAt: "",
  sessionFills: 0,
};

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
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function write(s: BotSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(s));
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

export const useBot = create<BotState>((set, get) => ({
  ...DEFAULTS,
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ ...read(), hydrated: true });
  },
  setOn: (on) => {
    set((s) => {
      const next = {
        on,
        universe: s.universe,
        lastNote: on ? "Armed. Next desk refresh will paper-fill signals." : "Paused.",
        lastAt: new Date().toISOString(),
        sessionFills: s.sessionFills,
      };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  setUniverse: (universe) => {
    set((s) => {
      const next = {
        on: s.on,
        universe,
        lastNote: s.lastNote,
        lastAt: s.lastAt,
        sessionFills: s.sessionFills,
      };
      write(next);
      return { ...next, hydrated: true };
    });
  },
  note: (text, fills = 0) => {
    set((s) => {
      const next = {
        on: s.on,
        universe: s.universe,
        lastNote: text,
        lastAt: new Date().toISOString(),
        sessionFills: s.sessionFills + fills,
      };
      write(next);
      return { ...next, hydrated: true };
    });
  },
}));
