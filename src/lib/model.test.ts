import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { liquidityScore, priceMarket, type ModelInput } from "./model.ts";

function closeIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

function base(partial: Partial<ModelInput> & Pick<ModelInput, "seriesTicker">): ModelInput {
  return {
    ticker: "TEST-1",
    eventTicker: "TEST",
    title: "Test",
    eventTitle: "Test event",
    yesSubTitle: "Yes",
    category: "Crypto",
    closeTime: closeIn(10 * 60 * 1000),
    mutuallyExclusive: false,
    fieldSize: 1,
    fieldSum: 0.35,
    bid: 0.33,
    ask: 0.37,
    last: 0.35,
    prevLast: 0.35,
    volume: 400,
    volume24h: 800,
    openInterest: 600,
    ...partial,
  };
}

function factor(m: ReturnType<typeof priceMarket>, id: string) {
  return m.factors.find((f) => f.id === id);
}

describe("priceMarket crypto skips", () => {
  it("does not fade a 15m ~35¢ print toward 31¢ (22:30 regression)", () => {
    const m = priceMarket(
      base({
        seriesTicker: "KXBTC15M",
        ticker: "KXBTC15M-2230",
        bid: 0.33,
        ask: 0.37,
        last: 0.35,
        prevLast: 0.35,
        closeTime: closeIn(10 * 60 * 1000),
      }),
    );
    assert.equal(m.mid, 0.35);
    assert.equal(factor(m, "cal")?.delta, 0);
    assert.equal(factor(m, "time")?.delta, 0);
    assert.ok(Math.abs(m.fair - 0.35) < 0.015, `fair ${m.fair} drifted off mid`);
    assert.ok(m.fair > 0.33, `fair ${m.fair} faded like the 22:30 miss`);
  });

  it("does not follow a stale prior-window prevLast on 15m", () => {
    const m = priceMarket(
      base({
        seriesTicker: "KXBTC15M",
        last: 0.35,
        prevLast: 0.9,
        bid: 0.33,
        ask: 0.37,
      }),
    );
    assert.equal(factor(m, "cal")?.delta, 0);
    assert.ok(Math.abs(m.fair - 0.35) < 0.02, `fair ${m.fair} chased prevLast`);
  });

  it("skips γ and time on hourly crypto rungs", () => {
    const m = priceMarket(
      base({
        seriesTicker: "KXBTCD",
        ticker: "KXBTCD-100000",
        bid: 0.04,
        ask: 0.06,
        last: 0.05,
        prevLast: 0.05,
        fieldSum: 3.2,
        fieldSize: 7,
        closeTime: closeIn(40 * 60 * 1000),
      }),
    );
    assert.equal(factor(m, "cal")?.delta, 0);
    assert.equal(factor(m, "time")?.delta, 0);
    assert.ok(Math.abs(m.fair - m.mid) < 0.02);
  });

  it("still applies sportsbook γ on non-crypto longshots and favorites", () => {
    const longshot = priceMarket(
      base({
        seriesTicker: "KXNFLGAME",
        category: "Sports",
        bid: 0.04,
        ask: 0.06,
        last: 0.05,
        prevLast: 0.05,
        closeTime: closeIn(5 * 86_400_000),
        volume24h: 80_000,
        openInterest: 200_000,
      }),
    );
    const favorite = priceMarket(
      base({
        seriesTicker: "KXNFLGAME",
        category: "Sports",
        bid: 0.78,
        ask: 0.82,
        last: 0.8,
        prevLast: 0.8,
        closeTime: closeIn(5 * 86_400_000),
        volume24h: 80_000,
        openInterest: 200_000,
      }),
    );
    const calLong = factor(longshot, "cal")?.delta ?? 0;
    const calFav = factor(favorite, "cal")?.delta ?? 0;
    assert.ok(calLong < -0.005, `longshot γ delta ${calLong}`);
    assert.ok(calFav > 0.005, `favorite γ delta ${calFav}`);
  });
});

describe("priceMarket gold skips", () => {
  it("does not fade a gold 15m print toward 0/1 (γ/time skipped)", () => {
    const m = priceMarket(
      base({
        seriesTicker: "KXGOLD15M",
        ticker: "KXGOLD15M-2600",
        bid: 0.33,
        ask: 0.37,
        last: 0.35,
        prevLast: 0.35,
        closeTime: closeIn(10 * 60 * 1000),
      }),
    );
    assert.equal(factor(m, "cal")?.delta, 0);
    assert.equal(factor(m, "time")?.delta, 0);
    assert.ok(Math.abs(m.fair - m.mid) < 0.02, `fair ${m.fair} drifted`);
  });

  it("skips γ and time on gold hourly ladder rungs", () => {
    const m = priceMarket(
      base({
        seriesTicker: "KXGOLDH",
        ticker: "KXGOLDH-T4407.68",
        bid: 0.04,
        ask: 0.06,
        last: 0.05,
        prevLast: 0.05,
        fieldSum: 3.2,
        fieldSize: 7,
        closeTime: closeIn(40 * 60 * 1000),
      }),
    );
    assert.equal(factor(m, "cal")?.delta, 0);
    assert.equal(factor(m, "time")?.delta, 0);
    assert.ok(Math.abs(m.fair - m.mid) < 0.02);
  });
});

describe("liquidityScore 15m scale", () => {
  it("scores a small 15m book as tradeable vs sportsbook caps", () => {
    const sports = liquidityScore(8, 10, 0.04);
    const fifteen = liquidityScore(8, 10, 0.04, { fifteen: true });
    assert.ok(sports < 0.28, `sports L ${sports} should miss the signal floor`);
    assert.ok(fifteen >= 0.28, `15m L ${fifteen} should clear the signal floor`);
  });
});
