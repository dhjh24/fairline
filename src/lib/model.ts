import type { DeskMarket, Factor, OrderBook, Signal } from "@/lib/types";
import { clamp01, dollars, marketMid, tauDays } from "@/lib/kalshi";

const GAMMA = 1.14;
const MIN_EDGE = 0.02;
const MIN_LIQ_FOR_SIGNAL = 0.28;

export function powerCalibrate(p: number, gamma = GAMMA): number {
  const x = clamp01(p, 1e-6, 1 - 1e-6);
  const a = x ** gamma;
  const b = (1 - x) ** gamma;
  return a / (a + b);
}

export function liquidityScore(vol24: number, oi: number, spread: number): number {
  const v = Math.log1p(Math.max(0, vol24)) / Math.log1p(500_000);
  const o = Math.log1p(Math.max(0, oi)) / Math.log1p(2_000_000);
  const tightness = 1 / (1 + Math.max(0.004, spread) * 25);
  return clamp01(0.45 * Math.min(1, v) + 0.25 * Math.min(1, o) + 0.3 * tightness, 0, 1);
}

export function kelly(p: number, price: number): number {
  if (price <= 0.004 || price >= 0.996) return 0;
  const f = (p - price) / (1 - price);
  return Math.max(0, Math.min(0.25, f));
}

function vigAdjusted(
  mid: number,
  mutuallyExclusive: boolean,
  fieldSize: number,
  fieldSum: number,
): number {
  if (!mutuallyExclusive || fieldSize < 3) return mid;
  if (fieldSum < 0.9 || fieldSum > 1.35) return mid;
  return clamp01(mid / fieldSum);
}

export type ModelInput = {
  ticker: string;
  eventTicker: string;
  seriesTicker: string;
  title: string;
  eventTitle: string;
  yesSubTitle: string;
  category: string;
  closeTime: string;
  mutuallyExclusive: boolean;
  fieldSize: number;
  fieldSum: number;
  bid: number;
  ask: number;
  last: number;
  prevLast: number;
  volume: number;
  volume24h: number;
  openInterest: number;
  bookImbalance?: number;
};

export function priceMarket(input: ModelInput): DeskMarket {
  const mid = marketMid(input.bid, input.ask, input.last);
  const spread =
    input.ask >= input.bid && input.ask > 0
      ? Math.max(0.004, input.ask - input.bid)
      : 0.04;
  const L = liquidityScore(input.volume24h, input.openInterest, spread);
  const tau = tauDays(input.closeTime);

  const factors: Factor[] = [];
  let p = mid;

  const afterVig = vigAdjusted(
    mid,
    input.mutuallyExclusive,
    input.fieldSize,
    input.fieldSum,
  );
  if (afterVig !== mid) {
    factors.push({
      id: "vig",
      label: "Event vig",
      delta: afterVig - p,
      detail:
        input.fieldSum > 1
          ? `Field sums to ${(input.fieldSum * 100).toFixed(0)}%. Removing overround.`
          : `Field sums to ${(input.fieldSum * 100).toFixed(0)}%. Lifting underround.`,
    });
  }
  p = afterVig;

  const afterCal = powerCalibrate(p);
  factors.push({
    id: "cal",
    label: "Longshot calibration",
    delta: afterCal - p,
    detail: "Power map (γ 1.14) trims longshots and lifts favorites.",
  });
  p = afterCal;

  let afterTime = p;
  if (tau < 10) {
    const ext = 0.1 * (1 - tau / 10) * L;
    afterTime = p + ext * (p - 0.5) * 2;
    factors.push({
      id: "time",
      label: "Near-expiry convexity",
      delta: afterTime - p,
      detail: `Settles in ${tau < 1 ? "hours" : `${tau.toFixed(0)}d`}. Pushing toward 0/1.`,
    });
  } else {
    const revert = 0.025 * Math.min(1, Math.log1p(tau / 180) / 4) * (1 - L);
    afterTime = p + revert * (0.5 - p);
    factors.push({
      id: "time",
      label: "Horizon fade",
      delta: afterTime - p,
      detail: `${tau.toFixed(0)} days out. Thin long-dated books fade slightly.`,
    });
  }
  p = afterTime;

  let mom = 0;
  if (input.prevLast > 0) mom += 0.25 * (input.last - input.prevLast);
  mom += 0.12 * (input.last - mid);
  const afterMom = p + mom * L;
  factors.push({
    id: "mom",
    label: "Tape momentum",
    delta: afterMom - p,
    detail:
      Math.abs(mom) < 0.002
        ? "Last trade sits on the mid."
        : input.last > mid
          ? "Last is above mid — buy pressure."
          : "Last is below mid — sell pressure.",
  });
  p = afterMom;

  if (typeof input.bookImbalance === "number" && Number.isFinite(input.bookImbalance)) {
    const afterBook = p + 0.06 * input.bookImbalance * L;
    factors.push({
      id: "book",
      label: "Book imbalance",
      delta: afterBook - p,
      detail:
        input.bookImbalance > 0.05
          ? "Bid depth outweighs offers."
          : input.bookImbalance < -0.05
            ? "Offer depth outweighs bids."
            : "Depth is roughly balanced.",
    });
    p = afterBook;
  }

  const fair = clamp01(p);
  const ask = input.ask > 0 ? input.ask : mid;
  const bid = input.bid > 0 ? input.bid : mid;
  const evYes = fair - ask;
  const evNo = bid - fair;
  const minEdge = MIN_EDGE + (1 - L) * 0.04;
  const halfSpread = spread * 0.45;

  let signal: Signal = "hold";
  const active = input.volume24h >= 20 || input.volume >= 400;
  if (
    active &&
    evYes >= evNo &&
    evYes >= minEdge &&
    evYes > halfSpread &&
    L >= MIN_LIQ_FOR_SIGNAL
  ) {
    signal = "yes";
  } else if (
    active &&
    evNo >= minEdge &&
    evNo > halfSpread &&
    L >= MIN_LIQ_FOR_SIGNAL
  ) {
    signal = "no";
  }

  const edge = signal === "yes" ? evYes : signal === "no" ? evNo : Math.max(evYes, evNo, 0);
  const absGap = Math.abs(fair - mid);
  const confidence = clamp01(
    0.2 + 0.55 * L + 0.25 * (1 / (1 + spread * 18)),
    0,
    1,
  );
  const score =
    (signal === "hold" ? absGap * 0.25 : edge) * (0.4 + 0.6 * L) * Math.log1p(input.volume24h);

  return {
    ticker: input.ticker,
    eventTicker: input.eventTicker,
    seriesTicker: input.seriesTicker,
    title: input.title,
    eventTitle: input.eventTitle,
    yesSubTitle: input.yesSubTitle,
    category: input.category,
    closeTime: input.closeTime,
    mutuallyExclusive: input.mutuallyExclusive,
    fieldSize: input.fieldSize,
    fieldSum: input.fieldSum,
    bid,
    ask,
    last: input.last,
    prevLast: input.prevLast,
    volume: input.volume,
    volume24h: input.volume24h,
    openInterest: input.openInterest,
    mid,
    fair,
    edge,
    evYes,
    evNo,
    signal,
    confidence,
    liquidity: L,
    kellyYes: kelly(fair, ask),
    kellyNo: kelly(1 - fair, 1 - bid),
    score,
    spread,
    tauDays: tau,
    factors,
  };
}

export function blendWithGrok(
  fair: number,
  grokP: number,
  grokConf: number,
): number {
  const w = 0.35 + 0.5 * clamp01(grokConf, 0, 1);
  return clamp01(w * grokP + (1 - w) * fair);
}

export function parseBook(
  raw: { yes_dollars?: [string, string][]; no_dollars?: [string, string][] } | undefined,
): OrderBook {
  const yes = raw?.yes_dollars ?? [];
  const no = raw?.no_dollars ?? [];

  const bids: { price: number; size: number }[] = yes
    .map(([p, s]) => ({ price: dollars(p), size: dollars(s) }))
    .filter((x) => x.price > 0 && x.size > 0)
    .sort((a, b) => b.price - a.price);

  const asks: { price: number; size: number }[] = no
    .map(([p, s]) => ({ price: clamp01(1 - dollars(p), 0.0001, 0.9999), size: dollars(s) }))
    .filter((x) => x.price > 0 && x.size > 0)
    .sort((a, b) => a.price - b.price);

  let run = 0;
  const bidLevels = bids.slice(0, 16).map((l) => {
    run += l.size;
    return { ...l, cumulative: run };
  });
  run = 0;
  const askLevels = asks.slice(0, 16).map((l) => {
    run += l.size;
    return { ...l, cumulative: run };
  });

  const bidDepth = bidLevels.reduce((s, l) => s + l.size, 0);
  const askDepth = askLevels.reduce((s, l) => s + l.size, 0);
  const tot = bidDepth + askDepth;
  const imbalance = tot > 0 ? bidDepth / tot - 0.5 : 0;

  return { bids: bidLevels, asks: askLevels, imbalance };
}
