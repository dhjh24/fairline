# Skill: kalshi

**Triggers:** 15m missing, ETH tape, 429, candles, not enough prints, implied spot, series

## Where

`src/lib/crypto.ts` — series lists, implied spot, 15m vs hourly.
`src/lib/desk-fn.ts` — fetch, candles, settlements.
`src/lib/kalshi.ts` — mids, URLs.
`src/components/crypto-tape.tsx`, `crypto-15.tsx`, `price-chart.tsx`.

## Fetch

1. `CRYPTO_FIRST` = `KXBTC15M`, `KXETH15M` at concurrency 2.
2. Then hourly / other series at concurrency 2. **Never** unbounded parallel on `KXBTCD`.
3. Merge onto the general events page so 15m is not dropped when the rest 429s.

## 15m vs hourly

| | 15m `KXBTC15M` / `KXETH15M` | Hourly `KXBTCD` / `KXETHD` |
|---|---|---|
| Shape | One binary vs CF print | Above/below ladder |
| UI | `CryptoFifteenCard` + countdown | `CryptoTapeCard` implied spot |
| Candles | `period_interval=1` | 1 if τ < 2d, else 60 |

Candles: `GET /series/{series}/markets/{ticker}/candlesticks`. Valid intervals **1, 60, 1440**. Hourly candles on a 15m book produce an empty chart (“Not enough prints”).

Countdown must not use `Date.now()` on the first client render (hydration mismatch). `now === null` until `useEffect`.

## Implied spot

`impliedSpot` = strike where the sorted mid ladder crosses 50¢. ATM window ~7 rungs for the desk list.

## Settlements

`loadSettledFifteen` — settled events, `limit=12` per series. Used by Score and the market-page print list.
