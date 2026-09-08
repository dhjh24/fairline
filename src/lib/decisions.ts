import type { BlotterLot } from "./blotter.ts";
import { cashOnHand, portfolioForRisk } from "./blotter.ts";
import {
  CLOSE_SKIP_MS,
  FRESH_QUOTE_MS,
  MAX_CONTRACTS,
  MAX_EXEC_PRICE,
  MAX_FILLS_PER_TICK,
  MAX_OPEN_BOT,
  MAX_SHARE,
  MIN_CASH,
  MIN_EXEC_EDGE,
  MIN_EXEC_PRICE,
  STRATEGY_VERSION,
  type BotUniverse,
  universeLabel,
} from "./bot-config.ts";
import { inUniverse } from "./bot-config.ts";
import { takerFeeUsd } from "./fees.ts";
import { MODEL_VERSION } from "./model.ts";
import { loadRiskSettings, pauseVeto } from "./risk.ts";
import type { DeskMarket, Signal } from "./types.ts";

/**
 * One typed decision record, shared by the bot engine, the desk UI and the
 * on-desk decision log. Every message shown to the user is derived from the
 * gate results below — never a disconnected string.
 */
export type BotPhase =
  | "OFF"
  | "CHECKING"
  | "HOLD"
  | "ELIGIBLE"
  | "PAPER FILLED"
  | "AWAITING SETTLEMENT"
  | "PAUSED"
  | "ERROR";

export type GateId =
  | "quote-fresh"
  | "already-open"
  | "close-window"
  | "off-board"
  | "model-signal"
  | "liquidity"
  | "edge-after-cost"
  | "size"
  | "cash"
  | "limits";

export type GateResult = {
  id: GateId;
  label: string;
  passed: boolean;
  detail: string;
};

export type BotDecision = {
  /** Unique id for this decision (ticker + quoteAsOf + decidedAt). */
  id: string;
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  title: string;
  eventTitle: string;
  category: string;
  closeTime: string;
  /** Fair and market mid at decision time — recorded on the paper lot. */
  fair: number;
  mid: number;
  /** When the bot evaluated. */
  decidedAt: string;
  /** When the underlying quote was produced (server desk snapshot). */
  quoteAt: string;
  quoteAgeSec: number;
  modelVersion: string;
  strategyVersion: string;
  phase: "HOLD" | "ELIGIBLE";
  /** The statistical model's call (yes/no/hold). */
  modelSignal: Signal;
  /** Candidate side for an eligible decision. */
  side?: "yes" | "no";
  /** Executable price per contract (YES ask, or 1 − YES bid for NO). */
  execPrice?: number;
  /** Gross EV per contract at the touch. */
  grossEdge?: number;
  /** Net EV per contract after the estimated Kalshi taker fee. */
  edgeAfterCost?: number;
  /** Proposed contracts and total cost (premium + estimated fee). */
  contracts?: number;
  totalCost?: number;
  feeUsd?: number;
  gates: GateResult[];
  /** Primary rejection reason, or undefined when eligible. */
  reject?: GateId;
  /** Plain-language reason — always derived from `gates`/`reject`. */
  reason: string;
};

export type BotLogEntry = {
  id: string;
  at: string;
  ticker: string;
  title: string;
  phase: BotPhase;
  side?: "yes" | "no";
  contracts?: number;
  edgeAfterCost?: number;
  reason: string;
};

export function decisionId(ticker: string, quoteAt: string, decidedAt: string): string {
  return `${ticker}@${quoteAt}@${decidedAt}`;
}

export function decisionReason(
  d: Pick<
    BotDecision,
    "side" | "gates" | "reject" | "modelSignal" | "edgeAfterCost"
  >,
): string {
  const fail = d.gates.find((g) => !g.passed);
  if (!fail && d.side) {
    const edge = d.edgeAfterCost ?? 0;
    return `Eligible: buy ${d.side.toUpperCase()} — ${(edge * 100).toFixed(1)}¢/contract after fee.`;
  }
  switch (d.reject ?? fail?.id) {
    case "quote-fresh":
      return "HOLD: quote is stale — waiting for a fresh desk snapshot.";
    case "already-open":
      return "HOLD: this market is already open in the paper book.";
    case "close-window":
      return "HOLD: too close to settlement (<45s).";
    case "off-board":
      return "HOLD: executable price is off the board (≤2¢ or ≥98¢).";
    case "model-signal":
      return "HOLD: model is inside the spread — no Buy YES / Buy NO signal.";
    case "edge-after-cost":
      return "HOLD: estimated edge does not cover costs (Kalshi taker fee).";
    case "liquidity":
      return "HOLD: quote too thin to size a fill.";
    case "size":
      return "HOLD: no positive Kelly size at this price.";
    case "cash":
      return "HOLD: not enough paper cash on hand.";
    case "limits":
      return "HOLD: a paper risk limit vetoed the fill.";
    default:
      return "HOLD: no eligible fill this refresh.";
  }
}

/**
 * One plain-language sentence for a desk row: what the model says and what a
 * paper buyer would actually pay after the estimated taker fee.
 */
export function marketPlainReason(m: DeskMarket): string {
  const side: "yes" | "no" = m.signal === "no" ? "no" : "yes";
  const execPrice = side === "yes" ? m.ask : 1 - m.bid;
  const gross = side === "yes" ? m.evYes : m.evNo;
  const net = side === "yes" ? m.evYesNet : m.evNoNet;
  const priceCents = Math.round(execPrice * 100);
  if (m.signal === "yes" || m.signal === "no") {
    return `Model says buy ${side.toUpperCase()} at ${priceCents}¢ — ${(gross * 100).toFixed(1)}¢ gross, ${(net * 100).toFixed(1)}¢ after the estimated fee.`;
  }
  const bestNet = Math.max(m.evYesNet, m.evNoNet);
  if (bestNet <= 0) {
    return "HOLD: model midpoint is inside the spread — no positive edge after costs.";
  }
  if (m.liquidity < 0.28) {
    return "HOLD: quote is too thin to trust a fill.";
  }
  return `HOLD: best executable edge is only ${(bestNet * 100).toFixed(1)}¢ after the estimated fee.`;
}

export type BotRound = {
  phase: BotPhase;
  /** One-line status for the bot bar. */
  note: string;
  /** Full per-candidate decisions (top-K by score kept). */
  decisions: BotDecision[];
  /** Decisions that passed every gate and are ready to fill. */
  eligible: BotDecision[];
  /** Portfolio-level pause veto, if any. */
  pausedReason: string | null;
};

export type DecisionContext = {
  markets: DeskMarket[];
  lots: BlotterLot[];
  universe: BotUniverse;
  quoteAt?: string;
  now?: number;
};

function quoteAgeSec(quoteAt: string | undefined, now: number): number {
  if (!quoteAt) return 0;
  const t = Date.parse(quoteAt);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 1000) : 0;
}

function sameOpenTicker(lots: BlotterLot[], ticker: string): boolean {
  return lots.some((l) => l.status === "open" && l.ticker === ticker);
}

/** Gate one candidate market into a typed decision. */
export function decideMarket(
  m: DeskMarket,
  lots: BlotterLot[],
  universe: BotUniverse,
  quoteAt: string | undefined,
  now: number,
): BotDecision {
  const gates: GateResult[] = [];
  const push = (id: GateId, label: string, passed: boolean, detail: string) =>
    gates.push({ id, label, passed, detail });

  const ageSec = quoteAgeSec(quoteAt ?? m.quoteAt, now);
  const close = Date.parse(m.closeTime);
  const closeMs = Number.isFinite(close) ? close - now : Infinity;

  const fresh = ageSec <= FRESH_QUOTE_MS / 1000;
  push(
    "quote-fresh",
    "Quote is fresh",
    fresh,
    fresh
      ? `${Math.round(ageSec)}s old`
      : `${Math.round(ageSec)}s old — over ${Math.round(FRESH_QUOTE_MS / 1000)}s limit`,
  );

  const open = sameOpenTicker(lots, m.ticker);
  push("already-open", "Not already open", !open, open ? "Open paper lot exists" : "No open lot");

  const notClosing = closeMs > CLOSE_SKIP_MS;
  push(
    "close-window",
    "Enough time before close",
    notClosing,
    notClosing ? `${Math.max(0, Math.round(closeMs / 1000))}s to close` : "Inside 45s of close",
  );

  const side: "yes" | "no" = m.signal === "no" ? "no" : "yes";
  const execPrice = side === "yes" ? m.ask : 1 - m.bid;
  const onBoard = execPrice >= MIN_EXEC_PRICE && execPrice <= MAX_EXEC_PRICE;
  push(
    "off-board",
    "Executable price on the board",
    onBoard,
    onBoard ? `${Math.round(execPrice * 100)}¢` : `${Math.round(execPrice * 100)}¢ off-board`,
  );

  const hasSignal = m.signal === "yes" || m.signal === "no";
  push(
    "model-signal",
    "Statistical signal fires",
    hasSignal,
    hasSignal ? `Signal ${m.signal.toUpperCase()}` : "Model holds",
  );

  const liqOk = m.liquidity >= 0.28;
  push(
    "liquidity",
    "Liquidity floor",
    liqOk,
    liqOk ? `liquidity ${m.liquidity.toFixed(2)}` : `liquidity ${m.liquidity.toFixed(2)} below floor`,
  );

  const grossEdge = side === "yes" ? m.evYes : m.evNo;
  const edgeAfterCost = side === "yes" ? m.evYesNet : m.evNoNet;
  const covers = edgeAfterCost >= MIN_EXEC_EDGE;
  push(
    "edge-after-cost",
    "Edge after estimated fee",
    covers,
    covers
      ? `${(edgeAfterCost * 100).toFixed(1)}¢/contract net`
      : `${(grossEdge * 100).toFixed(1)}¢ gross → ${(edgeAfterCost * 100).toFixed(1)}¢ net after fee`,
  );

  const cash = cashOnHand(lots);
  const openBot = lots.filter((l) => l.status === "open" && l.source === "bot").length;
  const slotsLeft = Math.max(0, MAX_OPEN_BOT - openBot);
  const openOk = slotsLeft > 0;
  push(
    "limits",
    "Open-position slot",
    openOk,
    openOk ? `${slotsLeft} bot slot${slotsLeft === 1 ? "" : "s"} left` : `${MAX_OPEN_BOT} open bot lots`,
  );

  const cashOk = cash >= MIN_CASH;
  push("cash", "Paper cash above floor", cashOk, cashOk ? `$${cash.toFixed(2)} cash` : `$${cash.toFixed(2)} cash`);

  // Size once gates so far look viable: half-Kelly, 10% cash cap, ≤40 contracts.
  let sized: { contracts: number; cost: number; feeUsd: number } | null = null;
  if (fresh && !open && notClosing && onBoard && hasSignal && covers && openOk && cashOk) {
    const kelly = side === "yes" ? m.kellyYes : m.kellyNo;
    const risk = Math.min(cash * kelly * 0.5, cash * MAX_SHARE);
    const n = Math.floor(risk / execPrice);
    if (n >= 1 && kelly > 0 && execPrice > 0) {
      const contracts = Math.min(MAX_CONTRACTS, n);
      const fee = takerFeeUsd(contracts, execPrice);
      sized = { contracts, feeUsd: fee, cost: contracts * execPrice + fee };
    }
  }
  const sizeOk = sized !== null;
  push(
    "size",
    "Kelly size is positive",
    sizeOk,
    sizeOk && sized ? `${sized.contracts} contracts ≈ $${sized.cost.toFixed(2)}` : "No positive size",
  );

  const reject = gates.find((g) => !g.passed)?.id;
  const phase = reject ? "HOLD" : "ELIGIBLE";
  const reason = decisionReason({
    side: phase === "ELIGIBLE" ? side : undefined,
    gates,
    reject,
    modelSignal: m.signal,
    edgeAfterCost,
  });

  return {
    id: decisionId(m.ticker, quoteAt ?? m.quoteAt ?? "", new Date(now).toISOString()),
    ticker: m.ticker,
    eventTicker: m.eventTicker,
    seriesTicker: m.seriesTicker,
    title: m.yesSubTitle || m.title,
    eventTitle: m.eventTitle,
    category: m.category,
    closeTime: m.closeTime,
    fair: m.fair,
    mid: m.mid,
    decidedAt: new Date(now).toISOString(),
    quoteAt: quoteAt ?? m.quoteAt ?? new Date(now).toISOString(),
    quoteAgeSec: Math.round(ageSec),
    modelVersion: MODEL_VERSION,
    strategyVersion: STRATEGY_VERSION,
    phase,
    modelSignal: m.signal,
    side: phase === "ELIGIBLE" ? side : undefined,
    execPrice: phase === "ELIGIBLE" ? execPrice : undefined,
    grossEdge: hasSignal ? grossEdge : undefined,
    edgeAfterCost: hasSignal ? edgeAfterCost : undefined,
    contracts: sized?.contracts,
    totalCost: sized?.cost,
    feeUsd: sized?.feeUsd,
    gates,
    reject,
    reason,
  };
}

/** Evaluate the whole desk for one bot tick. */
export function evaluateBotRound(ctx: DecisionContext): BotRound {
  const now = ctx.now ?? Date.now();
  const quoteAt = ctx.quoteAt;
  const cash = cashOnHand(ctx.lots);
  const paused = pauseVeto(loadRiskSettings(), portfolioForRisk(ctx.lots, {}, now));
  if (paused) {
    return {
      phase: "PAUSED",
      note: paused.message,
      decisions: [],
      eligible: [],
      pausedReason: paused.message,
    };
  }
  if (cash < MIN_CASH) {
    return {
      phase: "HOLD",
      note: `Not buying — paper cash is $${cash.toFixed(0)}.`,
      decisions: [],
      eligible: [],
      pausedReason: null,
    };
  }

  const candidates = ctx.markets
    .filter((m) => inUniverse(m.seriesTicker, ctx.universe, m.closeTime, now))
    .sort((a, b) => b.score - a.score)
    .slice(0, 24);

  const decisions = candidates.map((m) =>
    decideMarket(m, ctx.lots, ctx.universe, quoteAt ?? m.quoteAt, now),
  );
  const eligible = decisions.filter((d) => d.phase === "ELIGIBLE").slice(0, MAX_FILLS_PER_TICK);
  const openBot = ctx.lots.filter((l) => l.status === "open" && l.source === "bot").length;

  let note: string;
  let phase: BotPhase;
  if (eligible.length > 0) {
    phase = "ELIGIBLE";
    note = `ON. ${eligible
      .slice(0, 3)
      .map((d) => `${d.side === "no" ? "Buy NO" : "Buy YES"} · ${d.title}`)
      .join(" · ")} — fills at the touch.`;
  } else if (openBot > 0 && decisions.length === 0) {
    phase = "AWAITING SETTLEMENT";
    note = `ON. Watching ${universeLabel(ctx.universe)}. ${openBot} open bot lot${openBot === 1 ? "" : "s"} waiting to settle.`;
  } else {
    phase = "HOLD";
    const top = decisions[0];
    note = top
      ? `ON. ${top.reason}`
      : `ON. Watching ${universeLabel(ctx.universe)}. No eligible books this refresh.`;
  }

  return { phase, note, decisions, eligible, pausedReason: null };
}
