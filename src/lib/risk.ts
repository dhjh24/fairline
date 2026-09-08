import { create } from "zustand";

/**
 * Deterministic paper-risk vetoes. This module is the final gate for every
 * paper fill — manual tickets and bot tickets both pass through it, so a
 * portfolio limit (open positions, event exposure, daily loss) counts them
 * together. No LLM, no model output, no UI state can override a veto here.
 */

export type RiskVetoId =
  | "ticket-cost"
  | "exposure"
  | "event-exposure"
  | "open-count"
  | "daily-loss"
  | "cooldown"
  | "cash";

export type RiskVeto = {
  id: RiskVetoId;
  message: string;
};

export type RiskSettings = {
  /** Max paper dollars per ticket (premium + estimated fee). */
  ticketCostMax: number;
  /** Max total cost of open paper positions across all events. */
  exposureMax: number;
  /** Max open cost within a single event (mutually exclusive field set). */
  eventExposureMax: number;
  /** Max simultaneous open paper positions (manual + bot). */
  openMax: number;
  /** Max realized + unrealized paper loss in one UTC day before PAUSING the bot. */
  dailyLossMax: number;
  /** Min milliseconds between paper fills (manual + bot). */
  cooldownMs: number;
  /** Required paper cash on hand before any open is allowed. */
  minCash: number;
};

export const DEFAULT_RISK: RiskSettings = {
  ticketCostMax: 100,
  exposureMax: 500,
  eventExposureMax: 250,
  openMax: 20,
  dailyLossMax: 150,
  cooldownMs: 15_000,
  minCash: 5,
};

/** Aggregates computed by the blotter from its own lot/mark data. */
export type RiskPortfolio = {
  cash: number;
  openCost: number;
  openCount: number;
  eventOpenCost: number;
  dayLoss: number;
  lastOpenAt: number;
};

/** UTC calendar day key for daily-loss accounting. */
export function dayKey(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export type RiskCheckInput = {
  settings: RiskSettings;
  portfolio: RiskPortfolio;
  ticketCost: number;
  eventTicker: string;
  /** Fill time for cooldown checks — pass Date.now() when actually opening. */
  now?: number;
};

/**
 * Final veto before a paper open. `eventTicker` is the mutually-exclusive
 * event; when it is unknown (""), event exposure cannot be checked and only
 * the other limits apply.
 */
export function riskVeto(input: RiskCheckInput): RiskVeto | null {
  const { settings, portfolio, ticketCost, eventTicker } = input;
  const now = input.now ?? Date.now();

  if (portfolio.cash < settings.minCash) {
    return {
      id: "cash",
      message: `Not enough paper cash to trade ($${portfolio.cash.toFixed(2)} left, $${settings.minCash.toFixed(0)} minimum).`,
    };
  }
  if (!Number.isFinite(ticketCost) || ticketCost <= 0) {
    return { id: "ticket-cost", message: "Ticket cost must be positive." };
  }
  if (ticketCost > settings.ticketCostMax + 1e-9) {
    return {
      id: "ticket-cost",
      message: `Ticket $${ticketCost.toFixed(2)} exceeds the $${settings.ticketCostMax.toFixed(0)} paper limit.`,
    };
  }
  if (portfolio.openCost + ticketCost > settings.exposureMax + 1e-9) {
    return {
      id: "exposure",
      message: `Total open exposure would hit $${(portfolio.openCost + ticketCost).toFixed(2)} — over the $${settings.exposureMax.toFixed(0)} limit.`,
    };
  }
  if (eventTicker && portfolio.eventOpenCost + ticketCost > settings.eventExposureMax + 1e-9) {
    return {
      id: "event-exposure",
      message: `This event would reach $${(portfolio.eventOpenCost + ticketCost).toFixed(2)} — over the $${settings.eventExposureMax.toFixed(0)} per-event limit.`,
    };
  }
  if (portfolio.openCount + 1 > settings.openMax) {
    return {
      id: "open-count",
      message: `Already ${portfolio.openCount} open paper positions — the ${settings.openMax} limit is reached.`,
    };
  }
  if (portfolio.dayLoss <= -settings.dailyLossMax - 1e-9) {
    return {
      id: "daily-loss",
      message: `Daily paper loss ${portfolio.dayLoss.toFixed(2)} is at the $${settings.dailyLossMax.toFixed(0)} limit — no new tickets today.`,
    };
  }
  if (settings.cooldownMs > 0 && now - portfolio.lastOpenAt < settings.cooldownMs) {
    return {
      id: "cooldown",
      message: "Cooldown: waiting between paper fills.",
    };
  }
  return null;
}

/** Portfolio-level veto that should PAUSE the bot even when it has no ticket. */
export function pauseVeto(settings: RiskSettings, portfolio: RiskPortfolio): RiskVeto | null {
  if (portfolio.dayLoss <= -settings.dailyLossMax - 1e-9) {
    return {
      id: "daily-loss",
      message: `PAUSED: daily paper loss limit reached (${portfolio.dayLoss.toFixed(2)} vs $${settings.dailyLossMax.toFixed(0)}).`,
    };
  }
  if (portfolio.openCost >= settings.exposureMax - 1e-9 && portfolio.openCount > 0) {
    return {
      id: "exposure",
      message: `PAUSED: paper exposure cap reached ($${portfolio.openCost.toFixed(2)} of $${settings.exposureMax.toFixed(0)}).`,
    };
  }
  return null;
}

const KEY = "fairline-risk-v1";

export function loadRiskSettings(): RiskSettings {
  return read();
}

function read(): RiskSettings {
  if (typeof window === "undefined") return { ...DEFAULT_RISK };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_RISK };
    const p = JSON.parse(raw) as Partial<RiskSettings>;
    const num = (v: unknown, d: number) =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : d;
    return {
      ticketCostMax: num(p.ticketCostMax, DEFAULT_RISK.ticketCostMax),
      exposureMax: num(p.exposureMax, DEFAULT_RISK.exposureMax),
      eventExposureMax: num(p.eventExposureMax, DEFAULT_RISK.eventExposureMax),
      openMax: num(p.openMax, DEFAULT_RISK.openMax),
      dailyLossMax: num(p.dailyLossMax, DEFAULT_RISK.dailyLossMax),
      cooldownMs: num(p.cooldownMs, DEFAULT_RISK.cooldownMs),
      minCash: num(p.minCash, DEFAULT_RISK.minCash),
    };
  } catch {
    return { ...DEFAULT_RISK };
  }
}

function write(settings: RiskSettings) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(settings));
}

type RiskState = {
  hydrated: boolean;
  settings: RiskSettings;
  hydrate: () => void;
  update: (patch: Partial<RiskSettings>) => void;
  reset: () => void;
};

export const useRisk = create<RiskState>((set, get) => ({
  settings: { ...DEFAULT_RISK },
  hydrated: false,
  hydrate: () => {
    if (get().hydrated) return;
    set({ settings: read(), hydrated: true });
  },
  update: (patch) => {
    const settings = { ...get().settings, ...patch };
    write(settings);
    set({ settings, hydrated: true });
  },
  reset: () => {
    write({ ...DEFAULT_RISK });
    set({ settings: { ...DEFAULT_RISK }, hydrated: true });
  },
}));
