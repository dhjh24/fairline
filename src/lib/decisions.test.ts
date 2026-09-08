import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideMarket, evaluateBotRound, decisionReason } from "./decisions.ts";
import { MAX_OPEN_BOT, MIN_EXEC_EDGE } from "./bot-config.ts";
import type { DeskMarket } from "./types.ts";
import type { BlotterLot } from "./blotter.ts";

function mkt(partial: Partial<DeskMarket> & Pick<DeskMarket, "ticker" | "seriesTicker">): DeskMarket {
  return {
    eventTicker: "EVENT",
    title: "Test",
    eventTitle: "Event",
    yesSubTitle: "Test sub",
    category: "Crypto",
    closeTime: new Date(Date.now() + 30 * 60_000).toISOString(),
    mutuallyExclusive: false,
    fieldSize: 1,
    fieldSum: 0.9,
    bid: 0.45,
    ask: 0.55,
    last: 0.5,
    prevLast: 0.5,
    volume: 500,
    volume24h: 2000,
    openInterest: 500,
    mid: 0.5,
    fair: 0.5,
    edge: 0,
    evYes: 0,
    evNo: 0,
    evYesNet: 0,
    evNoNet: 0,
    execEdge: 0,
    signal: "hold",
    quoteQuality: 0.5,
    liquidity: 0.6,
    kellyYes: 0,
    kellyNo: 0,
    score: 1,
    spread: 0.1,
    tauDays: 0.02,
    factors: [],
    quoteAt: new Date().toISOString(),
    ...partial,
  };
}

function lot(partial: Partial<BlotterLot> = {}): BlotterLot {
  return {
    id: "l1",
    ticker: "KXBTC15M-X",
    eventTicker: "KXBTC15M",
    seriesTicker: "KXBTC15M",
    title: "t",
    eventTitle: "e",
    category: "c",
    closeTime: "2099-01-01T00:00:00.000Z",
    side: "yes",
    contracts: 1,
    fillPrice: 0.5,
    fairAtEntry: 0.5,
    midAtEntry: 0.5,
    openedAt: new Date().toISOString(),
    status: "open",
    ...partial,
  };
}

describe("decision gates", () => {
  it("eligible when the model fires and net edge clears the estimated fee", () => {
    const d = decideMarket(
      mkt({
        ticker: "KXBTC15M-HOT",
        seriesTicker: "KXBTC15M",
        bid: 0.45,
        ask: 0.55,
        mid: 0.5,
        fair: 0.62,
        signal: "yes",
        evYes: 0.07,
        evNo: 0,
        evYesNet: 0.05,
        evNoNet: 0,
        execEdge: 0.05,
        kellyYes: 0.1,
        liquidity: 0.6,
        quoteAt: new Date().toISOString(),
      }),
      [],
      "fifteen",
      new Date().toISOString(),
      Date.now(),
    );
    assert.equal(d.phase, "ELIGIBLE");
    assert.equal(d.reject, undefined);
    assert.ok(d.contracts && d.contracts > 0);
    assert.ok((d.edgeAfterCost ?? 0) >= MIN_EXEC_EDGE);
  });

  it("hold when the edge after the estimated fee does not cover costs", () => {
    const d = decideMarket(
      mkt({
        ticker: "KXBTC15M-THIN",
        seriesTicker: "KXBTC15M",
        bid: 0.48,
        ask: 0.52,
        mid: 0.5,
        fair: 0.54,
        signal: "yes",
        evYes: 0.02,
        evNo: 0,
        evYesNet: 0.003, // fee eats it
        evNoNet: 0,
        execEdge: 0,
        kellyYes: 0.02,
      }),
      [],
      "fifteen",
      new Date().toISOString(),
      Date.now(),
    );
    assert.equal(d.phase, "HOLD");
    assert.equal(d.reject, "edge-after-cost");
    assert.match(decisionReason(d), /HOLD: estimated edge does not cover costs/);
  });

  it("hold when the quote is stale", () => {
    const old = new Date(Date.now() - 10 * 60_000).toISOString();
    const d = decideMarket(
      mkt({
        ticker: "KXBTC15M-OLD",
        seriesTicker: "KXBTC15M",
        fair: 0.62,
        signal: "yes",
        evYes: 0.07,
        evYesNet: 0.05,
        execEdge: 0.05,
        quoteAt: old,
      }),
      [],
      "fifteen",
      old,
      Date.now(),
    );
    assert.equal(d.phase, "HOLD");
    assert.equal(d.reject, "quote-fresh");
  });

  it("hold when the market is already open in the paper book", () => {
    const open = lot({ ticker: "KXBTC15M-OPEN", status: "open" });
    const d = decideMarket(
      mkt({
        ticker: "KXBTC15M-OPEN",
        seriesTicker: "KXBTC15M",
        fair: 0.62,
        signal: "yes",
        evYes: 0.07,
        evYesNet: 0.05,
        execEdge: 0.05,
      }),
      [open],
      "fifteen",
      new Date().toISOString(),
      Date.now(),
    );
    assert.equal(d.reject, "already-open");
    assert.match(decisionReason(d), /already open/);
  });

  it("a model hold is recorded with its reason, not fabricated", () => {
    const d = decideMarket(
      mkt({
        ticker: "KXBTC15M-HOLD",
        seriesTicker: "KXBTC15M",
        fair: 0.5,
        signal: "hold",
      }),
      [],
      "fifteen",
      new Date().toISOString(),
      Date.now(),
    );
    assert.equal(d.phase, "HOLD");
    assert.equal(d.reject, "model-signal");
  });

  it("duplicate evaluation of the same market does not double-propose", () => {
    const hot = mkt({
      ticker: "KXBTC15M-DUP",
      seriesTicker: "KXBTC15M",
      fair: 0.62,
      signal: "yes",
      evYes: 0.07,
      evYesNet: 0.05,
      execEdge: 0.05,
      kellyYes: 0.1,
    });
    const q1 = new Date().toISOString();
    const d1 = decideMarket(hot, [], "fifteen", q1, Date.now());
    assert.equal(d1.phase, "ELIGIBLE");
    // After the first fill is in the blotter, the same market is held.
    const filled = lot({ ticker: "KXBTC15M-DUP", status: "open" });
    const d2 = decideMarket(hot, [filled], "fifteen", q1, Date.now());
    assert.equal(d2.phase, "HOLD");
    assert.equal(d2.reject, "already-open");
  });
});

describe("evaluateBotRound", () => {
  it("returns PAUSED with the loss-limit message when the daily veto fires", () => {
    const round = evaluateBotRound({
      markets: [],
      lots: [
        lot({
          side: "yes",
          fillPrice: 0.9,
          contracts: 200,
          status: "closed",
          closeReason: "settle-no",
          exitPrice: 0,
          closedAt: new Date().toISOString(),
        }),
      ],
      universe: "fifteen",
      now: Date.now(),
    });
    assert.equal(round.phase, "PAUSED");
    assert.match(round.note, /PAUSED: daily paper loss limit reached/);
  });

  it("caps bot slots at MAX_OPEN_BOT by holding further candidates", () => {
    const open = Array.from({ length: MAX_OPEN_BOT }, (_, i) =>
      lot({ id: `bot-${i}`, ticker: `KXBTC15M-${i}`, source: "bot", status: "open" }),
    );
    const market = mkt({
      ticker: "KXBTC15M-NEXT",
      seriesTicker: "KXBTC15M",
      fair: 0.62,
      signal: "yes",
      evYes: 0.07,
      evYesNet: 0.05,
      execEdge: 0.05,
      kellyYes: 0.1,
    });
    const round = evaluateBotRound({
      markets: [market],
      lots: open,
      universe: "fifteen",
      now: Date.now(),
    });
    assert.equal(round.eligible.length, 0);
    assert.equal(round.decisions[0]?.reject, "limits");
  });
});
