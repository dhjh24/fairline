export const BTC_SERIES = [
  "KXBTC15M",
  "KXBTCD",
  "KXBTCMAXY",
  "KXBTCMINY",
  "KXBTCMAXM",
  "KXBTCMAXW",
  "KXBTC100",
  "KXBTCATH",
  "KXBTC2026200",
] as const;

export const ETH_SERIES = ["KXETH15M", "KXETHD", "KXETHMAXY", "KXETHMINY"] as const;

/**
 * Gold (XAUUSD spot) mirrors the BTC/ETH pattern:
 * - KXGOLD15M: one binary up/down vs the CF print per 15-minute window.
 * - KXGOLDH: hourly above/below ladder (mutually exclusive event).
 * Longer gold series (daily/weekly/year) exist but are not on the desk.
 */
export const GOLD_SERIES = ["KXGOLD15M", "KXGOLDH"] as const;
export const GOLD_FIRST = ["KXGOLD15M"] as const;
export const GOLD_PRINT_SERIES = ["KXGOLD15M"] as const;
export const GOLD_HOURLY_SERIES = ["KXGOLDH"] as const;

export const CRYPTO_SERIES = [...BTC_SERIES, ...ETH_SERIES];
export const CRYPTO_FIRST = ["KXBTC15M", "KXETH15M"] as const;

export function isBitcoinSeries(series: string): boolean {
  const s = series.toUpperCase();
  return /^(KX)?BTC(\d|[A-Z]|$)/.test(s);
}

export function isEthereumSeries(series: string): boolean {
  const s = series.toUpperCase();
  return /^(KX)?ETH(\d|[A-Z]|$)/.test(s);
}

export function isGoldSeries(series: string): boolean {
  const s = series.toUpperCase();
  return (GOLD_SERIES as readonly string[]).includes(s);
}

export function isHourlyCrypto(series: string): boolean {
  const s = series.toUpperCase();
  return s === "KXBTCD" || s === "KXBTC" || s === "KXETHD" || s === "KXETH";
}

export function isFifteenCrypto(series: string): boolean {
  const s = series.toUpperCase();
  return s === "KXBTC15M" || s === "KXETH15M";
}

export function isGoldPrint(series: string): boolean {
  const s = series.toUpperCase();
  return (GOLD_PRINT_SERIES as readonly string[]).includes(s);
}

export function isGoldHourly(series: string): boolean {
  const s = series.toUpperCase();
  return (GOLD_HOURLY_SERIES as readonly string[]).includes(s);
}

/**
 * Binary CF-print contracts that settle every few minutes against the live
 * underlying print (BTC/ETH 15m + gold 15m). They share the short-horizon
 * treatment: never fade toward 0/1, and 1-minute candles on their detail page.
 */
export function isPrintMarket(series: string): boolean {
  return isFifteenCrypto(series) || isGoldPrint(series);
}

/**
 * Hourly above/below ladders (BTC/ETH/gold) that encode distance-from-spot:
 * the γ longshot map and near-expiry convexity are skipped for them.
 */
export function isHourlyLadder(series: string): boolean {
  return isHourlyCrypto(series) || isGoldHourly(series);
}

/** Anything on the desk that is a short print or an hourly ladder. */
export function isShortMarket(series: string): boolean {
  return isPrintMarket(series) || isHourlyLadder(series);
}

/** Asset label for the crypto/gold desk cards. */
export function assetLabel(series: string): string {
  if (isGoldSeries(series)) return "gold";
  if (isEthereumSeries(series)) return "eth";
  if (isBitcoinSeries(series)) return "btc";
  return "other";
}

export function strikeThreshold(floorStrike: number): number {
  if (!Number.isFinite(floorStrike) || floorStrike <= 0) return 0;
  const bumped = floorStrike + 0.01;
  if (Math.abs(bumped - Math.round(bumped)) < 0.001) return Math.round(bumped);
  return floorStrike;
}

export function impliedSpot(
  rungs: { strike: number; mid: number }[],
): number | null {
  const rows = rungs
    .filter((r) => r.strike > 0 && r.mid > 0 && r.mid < 1)
    .sort((a, b) => a.strike - b.strike);
  if (rows.length < 2) return null;
  for (let i = 0; i < rows.length - 1; i++) {
    const a = rows[i]!;
    const b = rows[i + 1]!;
    if (a.mid >= 0.5 && b.mid <= 0.5) {
      const span = a.mid - b.mid;
      if (span <= 1e-6) return (a.strike + b.strike) / 2;
      return a.strike + ((a.mid - 0.5) / span) * (b.strike - a.strike);
    }
  }
  if (rows[0]!.mid < 0.5) return rows[0]!.strike;
  return rows[rows.length - 1]!.strike;
}

export function pickAtmWindow<T extends { strike: number; mid: number }>(
  rungs: T[],
  count = 7,
): T[] {
  const rows = [...rungs].sort((a, b) => a.strike - b.strike);
  if (rows.length <= count) return rows;
  let atm = 0;
  let best = 1;
  for (let i = 0; i < rows.length; i++) {
    const d = Math.abs(rows[i]!.mid - 0.5);
    if (d < best) {
      best = d;
      atm = i;
    }
  }
  const half = Math.floor(count / 2);
  let lo = Math.max(0, atm - half);
  const hi = Math.min(rows.length, lo + count);
  lo = Math.max(0, hi - count);
  return rows.slice(lo, hi);
}
