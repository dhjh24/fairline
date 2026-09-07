# Skill: calibration

**Triggers:** Brier, honest, score page, was the model wrong, settlements, reliability

## Where

`src/lib/calibration.ts` — snaps, scoredRows, summarize, honest filter.
`src/components/calibration-view.tsx`, `settlement-loop.tsx`.

## Pipeline

1. Snapshot on desk refresh: 15m, tape rungs, signals, watchlist, open lots.
2. After close (+ ~20s), `getSettlements` reads Kalshi `result`.
3. Score `(fair − y)²`. Also `(mid − y)²`. **skill = market Brier − model Brier** (positive = model won).
4. Auto-settle matching paper lots to 100/0.

## Honest set (headline)

Keep a row only if:

- mid ∈ (0.08, 0.92)
- snap at least **90 seconds** before close

99¢ rungs snapped 8 minutes before an hourly close are not skill. Default Score filter is **Honest**.

Reliability bins should use honest rows. Do not brag about pooled ladder rungs (one event, many strikes).

## 15m

Fastest loop. Side-hit and signal-hit on those prints are the real score. Grok Brier is separate and often empty unless someone ran a forecast on that ticker.
