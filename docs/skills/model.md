# Skill: model

**Triggers:** fair, gamma, longshot, signal, Kelly, edge, 15m fade, calibration map, quote quality, net edge

## Where

`src/lib/model.ts` — `priceMarket`, `powerCalibrate`, signal gates, `MODEL_VERSION`.
`src/lib/fees.ts` — Kalshi taker-fee estimate used for net edges.
`src/components/app-shell.tsx` — methodology copy must match the code.

## Rules

- Fair is **not** last trade. Start from mid, then vig → cal → time → tape → book.
- γ **1.14** longshot map is for sportsbook-style longshots. **Skip on `isFifteenCrypto` and `isHourlyCrypto`.** Ladder rungs are distance-from-spot, not sports longshots.
- Near-expiry 0/1 push: **skip on 15m and hourly crypto** (`isHourlyCrypto`). The ladder already has time in it.
- 15m liquidity uses window-scale volume/OI caps (tens of thousands), not sportsbook $500k / $2M. Thin books still raise the signal bar; they do not shrink fair toward 50¢.
- 15m tape skips `previous_price` (often the prior window). Last-versus-mid still applies, scaled by liquidity.
- Signals: EV after **touch** (YES at ask, NO at bid) ≥ `MIN_EDGE` (2¢) plus a liquidity floor. Thin books raise the bar; they do not shrink fair toward 50¢.
- `MODEL_VERSION` is stamped on calibration snaps and bot decisions. Bump it when the pipeline or
  gates change so outcomes stay attributable.
- Net edges (`evYesNet`, `evNoNet`, `execEdge`) subtract the estimated Kalshi taker fee
  (`fees.ts`). The Edge sort and the desk/market rows use the **same** cost-aware number; hold
  rows show no executable edge. This does not change the raw signal gates.
- `quoteQuality` is a spread/depth liquidity index — it is NOT a probability-confidence score.
  Never label it “Confidence”.

## Do not

- Re-apply convexity to `KXBTC15M` / `KXETH15M` to “make 15m sharper.”
- Fire YES/NO on 1¢/99¢ coins (bot also refuses fill price ≤ 2¢ or ≥ 98¢).
- Add a second competing fair in the UI without blending it in `GrokPanel`.
- Present `quoteQuality` as confidence, or sort by a gap that the user is not shown.
- Tune γ or the time terms from a handful of losses; re-score honest 15m first.
