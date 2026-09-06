export const BTC_SERIES = [
  "KXBTCD",
  "KXBTCMAXY",
  "KXBTCMINY",
  "KXBTCMAXM",
  "KXBTCMAXW",
  "KXBTC100",
  "KXBTCATH",
  "KXBTC2026200",
] as const;

export const ETH_SERIES = ["KXETHD", "KXETHMAXY", "KXETHMINY"] as const;

export const CRYPTO_SERIES = [...BTC_SERIES, ...ETH_SERIES];

export function isBitcoinSeries(series: string): boolean {
  const s = series.toUpperCase();
  return /^(KX)?BTC(\d|[A-Z]|$)/.test(s);
}

export function isEthereumSeries(series: string): boolean {
  const s = series.toUpperCase();
  return /^(KX)?ETH(\d|[A-Z]|$)/.test(s);
}

export function isHourlyCrypto(series: string): boolean {
  const s = series.toUpperCase();
  return s === "KXBTCD" || s === "KXBTC" || s === "KXETHD" || s === "KXETH";
}

export function strikeThreshold(floorStrike: number): number {
  if (!Number.isFinite(floorStrike) || floorStrike <= 0) return 0;
  return Math.round(floorStrike + 0.01);
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
  let hi = Math.min(rows.length, lo + count);
  lo = Math.max(0, hi - count);
  return rows.slice(lo, hi);
}
