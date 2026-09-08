# Skill: calibration

**Triggers:** Brier, honest, score page, was the model wrong, settlements, reliability, series breakdown

## Where

`src/lib/calibration.ts` — snaps, scoredRows, summarize, honest filter, series/horizon breakdowns.
`src/components/calibration-view.tsx`, `settlement-loop.tsx`.

## Pipeline

1. Snapshot on desk **or Score** refresh (background `getDesk`, no Score loader). 15m, tape rungs, signals, watchlist, open lots. **First honest snap wins**; later quotes on that ticker are `last*` only. Every snap records the `modelVersion` that produced its fair.
2. After close (+ ~20s), `getSettlements` reads Kalshi `result`. Verdicts are exchange-confirmed only; manual blotter settles never enter the scored set.
3. Score `(fair − y)²`. Also `(mid − y)²`. **skill = market Brier − model Brier** (positive = model won).
4. Auto-settle matching paper lots to 100/0 (`settleProvenance: exchange`).

## Honest set (headline)

Keep a row only if:

- mid ∈ (0.08, 0.92)
- snap at least **90 seconds** before close

99¢ rungs snapped 8 minutes before an hourly close are not skill. Default Score filter is **Honest**.

Reliability bins should use honest rows. Do not brag about pooled ladder rungs (one event, many strikes).

## 15m

Fastest loop. Keep the **first honest snap** (mid 8¢–92¢, ≥90s to close). Later prints in the same window — often 99¢ or <90s — are stored as `last*` only and do not drive Brier.

Side-hit and signal-hit on those prints are the real score. Grok Brier is separate and often empty unless someone ran a forecast on that ticker.

Headline 15m Brier, signals, and side% use the honest set. Do not fall back to slam-dunk Brier when honest N is 0.

## By-series and horizon

`summarizeBySeries` groups by series kind (BTC/ETH 15m, hourly ladder, other). Ladder rungs from
one event share an event ticker and are reported with event counts — never treated as independent
samples. `summarizeByHorizon` buckets honest rows by snap lead time. Rows carry `modelVersion`,
which the calibration view shows as the scoring version.
