import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectDeskSnaps,
  isInformativeSnap,
  mergeLiveSnap,
  scoredRows,
  summarize,
  type QuoteSnap,
  type Verdict,
} from "./calibration.ts";
import type { DeskResponse } from "./types.ts";

function snap(partial: Partial<QuoteSnap> & Pick<QuoteSnap, "ticker">): QuoteSnap {
  return {
    eventTicker: "E",
    seriesTicker: "KXBTC15M",
    title: "BTC 15m",
    eventTitle: "BTC 15m",
    category: "Crypto",
    closeTime: "2026-09-07T20:00:00.000Z",
    mid: 0.35,
    fair: 0.35,
    bid: 0.33,
    ask: 0.37,
    signal: "hold",
    snappedAt: "2026-09-07T19:50:00.000Z",
    ...partial,
  };
}

describe("honest snap", () => {
  it("requires mid 8¢–92¢ and ≥90s of lead", () => {
    assert.equal(
      isInformativeSnap(0.35, "2026-09-07T20:00:00.000Z", "2026-09-07T19:50:00.000Z"),
      true,
    );
    assert.equal(
      isInformativeSnap(0.99, "2026-09-07T20:00:00.000Z", "2026-09-07T19:50:00.000Z"),
      false,
    );
    assert.equal(
      isInformativeSnap(0.35, "2026-09-07T20:00:00.000Z", "2026-09-07T19:59:30.000Z"),
      false,
    );
  });

  it("does not let a last-second 99¢ print replace the first honest snap", () => {
    const first = snap({ ticker: "KXBTC15M-A", mid: 0.35, fair: 0.36 });
    const last = snap({
      ticker: "KXBTC15M-A",
      mid: 0.99,
      fair: 0.99,
      snappedAt: "2026-09-07T19:59:50.000Z",
    });
    const kept = mergeLiveSnap(first, last);
    assert.equal(kept.mid, 0.35);
    assert.equal(kept.fair, 0.36);
    assert.equal(kept.lastMid, 0.99);
    assert.equal(kept.lastFair, 0.99);
  });
});

describe("collectDeskSnaps", () => {
  it("always includes live 15m cards", () => {
    const data = {
      asOf: "2026-09-07T20:00:00.000Z",
      markets: [],
      categories: [],
      stats: {
        scanned: 0,
        returned: 0,
        edges: 0,
        yes: 0,
        no: 0,
        hold: 0,
        medianAbsEdge: 0,
        volume24h: 0,
      },
      btc15: {
        asset: "btc",
        name: "Bitcoin 15m",
        ticker: "KXBTC15M-NOW",
        target: 79100,
        mid: 0.48,
        fair: 0.48,
        bid: 0.46,
        ask: 0.5,
        signal: "hold",
        edge: 0,
        volume24h: 1000,
        closeTime: "2026-09-07T20:15:00.000Z",
        title: "BTC 15m",
        eventTitle: "BTC 15m",
      },
    } as DeskResponse;
    const rows = collectDeskSnaps(data, [], [], {});
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.ticker, "KXBTC15M-NOW");
    assert.equal(rows[0]?.seriesTicker, "KXBTC15M");
  });
});

describe("summarize headline", () => {
  it("does not treat a 99¢ 15m slam-dunk as 15m skill", () => {
    const slam = snap({ ticker: "KXBTC15M-SLAM", mid: 0.99, fair: 0.99 });
    const honest = snap({ ticker: "KXBTC15M-OK", mid: 0.4, fair: 0.42 });
    const verdicts: Record<string, Verdict> = {
      "KXBTC15M-SLAM": { ticker: "KXBTC15M-SLAM", result: "yes", resolvedAt: "2026-09-07T20:01:00.000Z" },
      "KXBTC15M-OK": { ticker: "KXBTC15M-OK", result: "no", resolvedAt: "2026-09-07T20:01:00.000Z" },
    };
    const rows = scoredRows(
      { "KXBTC15M-SLAM": slam, "KXBTC15M-OK": honest },
      verdicts,
    );
    const s = summarize(rows);
    assert.equal(s.n, 2);
    assert.equal(s.honestN, 1);
    assert.equal(s.fifteenN, 1);
    assert.ok(s.fifteenBrier > 0.1);
    assert.equal(s.fifteenBrier, s.honestBrier);
  });
});
