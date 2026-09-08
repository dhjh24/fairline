import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  entryCostWithFee,
  FEE_POLICY_ID,
  feePerContractEstimate,
  netEdgeAfterFee,
  rawTakerFee,
  takerFeeUsd,
} from "./fees.ts";

describe("Kalshi taker fee (official schedule math)", () => {
  it("matches the published per-100-contract table", () => {
    // From the fee schedule: price → fee per 100 contracts.
    const table: [number, number][] = [
      [0.01, 0.07],
      [0.05, 0.34],
      [0.1, 0.63],
      [0.15, 0.9],
      [0.2, 1.12],
      [0.25, 1.32],
      [0.3, 1.47],
      [0.35, 1.6],
      [0.4, 1.68],
      [0.45, 1.74],
      [0.5, 1.75],
      [0.55, 1.74],
      [0.6, 1.68],
      [0.65, 1.6],
      [0.7, 1.47],
      [0.75, 1.32],
      [0.8, 1.12],
      [0.85, 0.9],
      [0.9, 0.63],
      [0.95, 0.34],
      [0.99, 0.07],
    ];
    for (const [price, expected] of table) {
      const got = takerFeeUsd(100, price);
      assert.ok(
        Math.abs(got - expected) < 0.005,
        `P=${price}: expected $${expected}, got $${got}`,
      );
    }
  });

  it("rounds the whole ticket up to the next cent", () => {
    // 25 contracts at $0.50: raw 0.4375 → total 12.9375 → 12.94 → fee 0.44.
    const fee = takerFeeUsd(25, 0.5);
    assert.equal(fee, 0.44);
    assert.equal(entryCostWithFee(25, 0.5), 12.94);
  });

  it("never charges when there are no contracts", () => {
    assert.equal(takerFeeUsd(0, 0.5), 0);
    assert.equal(rawTakerFee(-3, 0.5), 0);
  });

  it("fee is a U-shaped fraction of price — peak near the coin flip", () => {
    const atMid = feePerContractEstimate(0.5, 100);
    const atLongshot = feePerContractEstimate(0.05, 100);
    assert.ok(atMid > atLongshot, `mid fee ${atMid} should exceed longshot ${atLongshot}`);
  });

  it("policy id pins the assumption for stored fills", () => {
    assert.equal(FEE_POLICY_ID, "kalshi-taker-0.07-2026-07");
  });

  it("net edge subtracts the estimated fee", () => {
    assert.ok(netEdgeAfterFee(0.05, 0.5) < 0.05);
    assert.equal(netEdgeAfterFee(0.02, 0.5), 0.02 - feePerContractEstimate(0.5));
  });
});
