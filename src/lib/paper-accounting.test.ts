import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { takerFeeUsd } from "./fees.ts";
import {
  blotterTotals,
  cashOnHand,
  lotEntryCost,
  lotPnl,
  portfolioForRisk,
  sideMark,
  STARTING_CASH,
  type BlotterLot,
} from "./blotter.ts";
import { DEFAULT_RISK, riskVeto, pauseVeto, type RiskPortfolio } from "./risk.ts";

function lot(partial: Partial<BlotterLot> & Pick<BlotterLot, "side" | "fillPrice" | "contracts">): BlotterLot {
  return {
    id: `lot-${Math.random()}`,
    ticker: "KX-T",
    eventTicker: "KX-E",
    seriesTicker: "KXBTCD",
    title: "Test",
    eventTitle: "Test event",
    category: "Crypto",
    closeTime: "2099-01-01T00:00:00.000Z",
    fairAtEntry: partial.fillPrice,
    midAtEntry: partial.fillPrice,
    openedAt: "2026-09-07T12:00:00.000Z",
    status: "open",
    source: "manual",
    feePolicy: "kalshi-taker-0.07-2026-07",
    ...partial,
  };
}

describe("paper accounting with Kalshi fees", () => {
  it("open lot cash deducts premium plus fee", () => {
    const l = lot({ side: "yes", fillPrice: 0.5, contracts: 10 });
    l.feeUsd = takerFeeUsd(10, 0.5); // whole-ticket
    assert.equal(lotEntryCost(l), 10 * 0.5 + l.feeUsd);
    assert.equal(cashOnHand([l]), STARTING_CASH - lotEntryCost(l));
  });

  it("settlement payouts are exact 100/0 and net of fee", () => {
    const yesWon = lot({
      id: "y",
      side: "yes",
      fillPrice: 0.4,
      contracts: 20,
      status: "closed",
      closeReason: "settle-yes",
      exitPrice: 1,
      closedAt: "2026-09-07T13:00:00.000Z",
      settleProvenance: "exchange",
      exitBasis: "settle",
    });
    yesWon.feeUsd = takerFeeUsd(20, 0.4);
    // Payout $20, premium $8, fee deducted.
    assert.equal(lotPnl(yesWon, 0), 20 - lotEntryCost(yesWon));

    const noLost = lot({
      id: "n",
      side: "no",
      fillPrice: 0.45, // bought NO at 45¢
      contracts: 10,
      status: "closed",
      closeReason: "settle-no",
      exitPrice: 0,
      closedAt: "2026-09-07T13:01:00.000Z",
      settleProvenance: "exchange",
      exitBasis: "settle",
    });
    noLost.feeUsd = takerFeeUsd(10, 0.45);
    assert.equal(lotPnl(noLost, 0), -lotEntryCost(noLost));
  });

  it("side conversion marks a NO lot off the YES price", () => {
    assert.equal(sideMark("no", 0.3), 0.7);
    assert.equal(sideMark("yes", 0.3), 0.3);
  });

  it("void lots neither charge cash nor count in totals", () => {
    const v = lot({
      side: "yes",
      fillPrice: 0.5,
      contracts: 10,
      status: "closed",
      closeReason: "void",
      exitPrice: 0.5,
      closedAt: "2026-09-07T13:00:00.000Z",
    });
    v.feeUsd = takerFeeUsd(10, 0.5);
    assert.equal(cashOnHand([v]), STARTING_CASH);
    const t = blotterTotals([v], {});
    assert.equal(t.openCount + t.closedCount, 0);
    assert.equal(t.feesPaid, 0);
  });

  it("totals reconcile: equity = cash + open market value, fees counted", () => {
    const a = lot({ id: "a", side: "yes", fillPrice: 0.5, contracts: 10, closeTime: "2099-01-01T00:00:00.000Z" });
    a.feeUsd = takerFeeUsd(10, 0.5);
    const b = lot({
      id: "b",
      side: "no",
      fillPrice: 0.4,
      contracts: 5,
      status: "closed",
      closeReason: "settle-yes",
      exitPrice: 0,
      closedAt: "2026-09-07T13:00:00.000Z",
    });
    b.feeUsd = takerFeeUsd(5, 0.4);
    const t = blotterTotals([a, b], {});
    assert.ok(Math.abs(t.equityMarket - (t.cash + t.openMarketValue)) < 1e-9);
    assert.ok(t.feesPaid > 0);
  });
});

describe("risk vetoes", () => {
  const base: RiskPortfolio = {
    cash: 500,
    openCost: 0,
    openCount: 0,
    eventOpenCost: 0,
    dayLoss: 0,
    lastOpenAt: 0,
  };

  it("ticket cost over limit is vetoed", () => {
    const v = riskVeto({
      settings: DEFAULT_RISK,
      portfolio: base,
      ticketCost: 500,
      eventTicker: "E",
      now: Date.now(),
    });
    assert.equal(v?.id, "ticket-cost");
  });

  it("exposure cap counts open positions together", () => {
    const v = riskVeto({
      settings: DEFAULT_RISK,
      portfolio: { ...base, openCost: 480 },
      ticketCost: 30,
      eventTicker: "E",
    });
    assert.equal(v?.id, "exposure");
  });

  it("event exposure is scoped per event", () => {
    const v = riskVeto({
      settings: DEFAULT_RISK,
      portfolio: { ...base, eventOpenCost: 240 },
      ticketCost: 20,
      eventTicker: "E",
    });
    assert.equal(v?.id, "event-exposure");
  });

  it("daily loss limit pauses the bot", () => {
    const p: RiskPortfolio = { ...base, dayLoss: -160 };
    const v = pauseVeto(DEFAULT_RISK, p);
    assert.equal(v?.id, "daily-loss");
    assert.match(v?.message ?? "", /PAUSED: daily paper loss limit reached/);
  });

  it("cooldown blocks fills spaced too close", () => {
    const now = Date.now();
    const v = riskVeto({
      settings: { ...DEFAULT_RISK, cooldownMs: 15_000 },
      portfolio: { ...base, lastOpenAt: now - 5_000 },
      ticketCost: 20,
      eventTicker: "E",
      now,
    });
    assert.equal(v?.id, "cooldown");
    const ok = riskVeto({
      settings: { ...DEFAULT_RISK, cooldownMs: 15_000 },
      portfolio: { ...base, lastOpenAt: now - 20_000 },
      ticketCost: 20,
      eventTicker: "E",
      now,
    });
    assert.equal(ok, null);
  });

  it("manual and bot lots both count toward open positions", () => {
    const lots = [
      lot({ id: "m", source: "manual", side: "yes", fillPrice: 0.3, contracts: 10, status: "open" }),
      lot({ id: "b", source: "bot", side: "no", fillPrice: 0.4, contracts: 5, status: "open" }),
    ];
    const p = portfolioForRisk(lots, {}, Date.now());
    assert.equal(p.openCount, 2);
    assert.ok(p.openCost > 0);
  });

  it("portfolioForRisk rolls today's realized loss into the daily limit", () => {
    const closed = lot({
      id: "c",
      side: "yes",
      fillPrice: 0.7,
      contracts: 10,
      status: "closed",
      closeReason: "settle-no",
      exitPrice: 0,
      closedAt: new Date().toISOString(),
      settleProvenance: "exchange",
    });
    closed.feeUsd = takerFeeUsd(10, 0.7);
    const p = portfolioForRisk([closed], {}, Date.now());
    assert.ok(p.dayLoss < -6.9, `dayLoss ${p.dayLoss} should include the lost premium + fee`);
  });
});
