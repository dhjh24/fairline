# Skill: model

**Triggers:** fair, gamma, longshot, signal, Kelly, edge, 15m fade, calibration map

## Where

`src/lib/model.ts` — `priceMarket`, `powerCalibrate`, signal gates.
`src/components/app-shell.tsx` — methodology copy must match the code.

## Rules

- Fair is **not** last trade. Start from mid, then vig → cal → time → tape → book.
- γ **1.14** longshot map is for sportsbook-style longshots. **Skip on `isFifteenCrypto`.**
- Near-expiry 0/1 push: **skip on 15m and hourly crypto** (`isHourlyCrypto`). The ladder already has time in it.
- Signals: EV after **touch** (YES at ask, NO at bid) ≥ `MIN_EDGE` (2¢) plus a liquidity floor. Thin books raise the bar; they do not shrink fair toward 50¢.
- If you retune γ or time, **re-score honest 15m first**. The 22:30 window (faded 35¢ → 31¢, settled YES) is the regression test.

## Do not

- Re-apply convexity to `KXBTC15M` / `KXETH15M` to “make 15m sharper.”
- Fire YES/NO on 1¢/99¢ coins (bot also refuses fill price ≤ 2¢ or ≥ 98¢).
- Add a second competing fair in the UI without blending it in `GrokPanel`.
