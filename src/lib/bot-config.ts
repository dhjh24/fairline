import { isPrintMarket } from "./crypto.ts";

/**
 * Shared paper-bot configuration. Kept import-cycle-free so `decisions.ts`,
 * `bot.ts` and UI components can all read the same numbers.
 *
 * Strategy version bumps whenever the eligibility rules below change. It is
 * recorded on every bot decision so the log can attribute behavior to rules.
 */
export type BotUniverse = "fifteen" | "fast" | "signals";

export const STRATEGY_VERSION = "paper-bot-v2-fee-aware-2026-09";

export const MAX_OPEN_BOT = 12;
export const MAX_FILLS_PER_TICK = 4;
export const MIN_CASH = 5;
export const MAX_SHARE = 0.1; // 10% of paper cash per ticket
export const MAX_CONTRACTS = 40;
/** Skip fills whose executable price is this close to 0 or 1 (Kalshi quote grid). */
export const MIN_EXEC_PRICE = 0.02;
export const MAX_EXEC_PRICE = 0.98;
/** Skip signals inside this window of the settlement deadline. */
export const CLOSE_SKIP_MS = 45_000;
/** A quote older than this is stale: the bot will not trade on it. */
export const FRESH_QUOTE_MS = 6 * 60_000;
/** Minimum net edge per contract after the estimated taker fee to fill. */
export const MIN_EXEC_EDGE = 0.005;
/** How many decision records the on-desk log keeps. */
export const MAX_DECISION_LOG = 24;

export function universeLabel(universe: BotUniverse): string {
  if (universe === "fifteen") return "15-minute BTC, ETH and gold";
  if (universe === "fast") return "books closing within 6 hours";
  return "desk signals";
}

export function inUniverse(
  seriesTicker: string,
  universe: BotUniverse,
  closeTime: string,
  now = Date.now(),
): boolean {
  if (universe === "fifteen") return isPrintMarket(seriesTicker);
  if (universe === "fast") {
    const close = Date.parse(closeTime);
    if (!Number.isFinite(close) || close - now > 6 * 3_600_000) return false;
    return true;
  }
  return true;
}
