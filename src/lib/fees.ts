/**
 * Kalshi taker-fee assumptions used by the paper desk.
 *
 * Verified against Kalshi's published Fee Schedule (fee schedule PDF,
 * "July 2026 — 7.7.26 Update" and https://kalshi.com/fee-schedule):
 *
 *   taker fees = round up( M × 0.07 × C × P × (1 − P) )
 *
 * where P is the contract price in dollars, C is the number of contracts,
 * M is the per-series multiplier (default 1), and the total (position cost +
 * fee) is rounded up to the next cent. Fees are only charged for orders that
 * immediately match resting orders — every paper fill here is a taker at the
 * touch, so the taker formula applies. There is no settlement fee and no fee
 * for cancelling resting orders.
 *
 * The round-up is applied to the whole ticket, so per-contract fee depends on
 * the number of contracts. We do NOT invent per-series multipliers for the
 * crypto series (default M = 1); if a series' fee tier changes, bump
 * FEE_POLICY_ID so old fills stay comparable.
 */
export const FEE_POLICY_ID = "kalshi-taker-0.07-2026-07";
export const FEE_TAKER_RATE = 0.07;
export const FEE_REFERENCE_CONTRACTS = 25;

/** Raw fee in dollars before the whole-ticket cent round-up. */
export function rawTakerFee(contracts: number, price: number): number {
  if (!Number.isFinite(contracts) || contracts <= 0 || !Number.isFinite(price)) return 0;
  const p = Math.min(0.999, Math.max(0.001, price));
  return FEE_TAKER_RATE * contracts * p * (1 - p);
}

/**
 * Total entry cost (position + fee) with the official cent round-up.
 * Verified against the schedule table: 100 contracts at $0.50 → $50.00 + $1.75.
 */
export function entryCostWithFee(contracts: number, price: number): number {
  const n = Math.max(0, Math.floor(contracts));
  if (n === 0) return 0;
  const posCents = Math.round(n * price * 100);
  return entryCostCents(n, price, posCents) / 100;
}

/** Fee in dollars for this ticket (rounded whole-ticket). Integer-cent math. */
export function takerFeeUsd(contracts: number, price: number): number {
  const n = Math.max(0, Math.floor(contracts));
  if (n === 0) return 0;
  const posCents = Math.round(n * price * 100);
  const totalCents = entryCostCents(n, price, posCents);
  return (totalCents - posCents) / 100;
}

/** Total entry cost in integer cents with the official cent round-up. */
function entryCostCents(n: number, price: number, posCents: number): number {
  const rawCents = FEE_TAKER_RATE * n * price * (1 - price) * 100;
  return Math.max(posCents, Math.ceil(posCents + rawCents - 1e-9));
}

/**
 * Per-contract fee estimate at a reference ticket size. Real fees are
 * whole-ticket-rounded, so this is a display/edge estimate, not the exact fee
 * for every size. At tiny sizes the actual per-contract fee is higher.
 */
export function feePerContractEstimate(price: number, contracts = FEE_REFERENCE_CONTRACTS): number {
  if (contracts <= 0) return 0;
  return takerFeeUsd(contracts, price) / Math.floor(contracts);
}

/**
 * Net expected value per contract after the estimated taker fee, given a
 * gross edge per contract. `null` means no executable side.
 */
export function netEdgeAfterFee(grossEdgePerContract: number, price: number): number {
  if (!Number.isFinite(grossEdgePerContract)) return 0;
  return grossEdgePerContract - feePerContractEstimate(price);
}
