import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import {
  STARTING_CASH,
  blotterTotals,
  lotCost,
  lotPnl,
  sideMark,
  useBlotter,
  type BlotterLot,
  type CloseReason,
} from "@/lib/blotter";
import { pct, relativeClose, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Filter = "open" | "closed" | "bot" | "manual" | "all";

export function BlotterView() {
  const lots = useBlotter((s) => s.lots);
  const marks = useBlotter((s) => s.marks);
  const closeLot = useBlotter((s) => s.closeLot);
  const voidLot = useBlotter((s) => s.voidLot);
  const reset = useBlotter((s) => s.reset);
  const [filter, setFilter] = useState<Filter>("open");
  const totals = useMemo(() => blotterTotals(lots, marks), [lots, marks]);

  const visible = useMemo(() => {
    const rows = lots.filter((l) => l.closeReason !== "void");
    if (filter === "open") return rows.filter((l) => l.status === "open");
    if (filter === "closed") return rows.filter((l) => l.status === "closed");
    if (filter === "bot") return rows.filter((l) => l.source === "bot");
    if (filter === "manual") return rows.filter((l) => l.source !== "bot");
    return rows;
  }, [lots, filter]);

  const visibleLots = lots.filter((l) => l.closeReason !== "void");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div>
          <h1 className="text-3xl font-medium tracking-tight md:text-4xl">Paper blotter</h1>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
            Hypothetical fills at the touch. The paper bot takes Fairline signals
            on its own; open lots mark to Kalshi's mid and to Fairline's fair.
            Starting cash ${STARTING_CASH.toLocaleString()}.
          </p>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Equity" value={`$${totals.equityMarket.toFixed(2)}`} hint="Mark to market" />
        <Stat
          label="Market P&L"
          value={usd(totals.realized + totals.unrealizedMarket)}
          tone={totals.realized + totals.unrealizedMarket}
        />
        <Stat
          label="Model P&L"
          value={usd(totals.realized + totals.unrealizedModel)}
          tone={totals.realized + totals.unrealizedModel}
        />
        <Stat label="Realized" value={usd(totals.realized)} tone={totals.realized} />
        <Stat label="Open lots" value={String(totals.openCount)} hint={`${totals.closedCount} closed`} />
        <Stat label="Cash" value={`$${totals.cash.toFixed(2)}`} hint={`Tied $${totals.openCost.toFixed(2)}`} />
      </section>

      <div className="flex flex-wrap gap-2">
        {(
          [
            ["open", "Open"],
            ["closed", "Closed"],
            ["bot", "Bot"],
            ["manual", "Manual"],
            ["all", "All lots"],
          ] as const
        ).map(([id, label]) => (
          <Button
            key={id}
            type="button"
            size="sm"
            variant={filter === id ? "primary" : "secondary"}
            onClick={() => setFilter(id)}
          >
            {label}
          </Button>
        ))}
        {visibleLots.length > 0 ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="ghost" size="sm">
                Reset book
              </Button>
            </DialogTrigger>
            <DialogContent title="Reset the paper book?">
              <p className="text-sm text-muted">
                This clears every lot and returns cash to ${STARTING_CASH.toLocaleString()}. It
                cannot be undone.
              </p>
              <Button className="mt-4" variant="no" onClick={() => reset()}>
                Clear all lots
              </Button>
            </DialogContent>
          </Dialog>
        ) : null}
        <span className="ml-auto self-center text-xs text-subtle tabular-nums">
          {visible.length} shown
        </span>
      </div>

      {visibleLots.length === 0 ? (
        <div className="rounded-xl bg-surface px-6 py-16 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">No paper fills yet.</p>
          <p className="mt-2 text-sm text-subtle">
            Open a market, size a ticket, and tap Log paper fill — or start the paper
            bot on the desk.
          </p>
          <Button asChild className="mt-4">
            <Link to="/">Back to the desk</Link>
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl bg-surface px-6 py-12 text-center shadow-[var(--shadow-border)]">
          <p className="text-sm text-muted">Nothing in this tab.</p>
        </div>
      ) : (
        <ul className="flex flex-col rounded-xl bg-surface shadow-[var(--shadow-border)]">
          {visible.map((lot) => (
            <LotRow
              key={lot.id}
              lot={lot}
              mid={marks[lot.ticker]?.mid ?? lot.midAtEntry}
              fair={marks[lot.ticker]?.fair ?? lot.fairAtEntry}
              onFlatten={() => closeLot(lot.id, "flatten", sideMark(lot.side, marks[lot.ticker]?.mid ?? lot.midAtEntry))}
              onSettle={(reason) => {
                const yes = reason === "settle-yes" ? 1 : 0;
                closeLot(lot.id, reason, sideMark(lot.side, yes));
              }}
              onVoid={() => voidLot(lot.id)}
            />
          ))}
        </ul>
      )}

      <p className="text-xs text-subtle">
        Paper book only — not a Kalshi order, not financial advice. Flatten closes at the
        last mid. Settle YES/NO as if the contract paid $1 or $0.
      </p>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: number;
}) {
  return (
    <div className="rounded-lg bg-surface px-3 py-3 shadow-[var(--shadow-border)]">
      <p className="text-xs text-muted">{label}</p>
      <p
        className={cn(
          "mt-1 text-lg font-medium tracking-tight tabular-nums",
          typeof tone === "number" && tone > 0 && "text-yes",
          typeof tone === "number" && tone < 0 && "text-no",
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-xs text-subtle">{hint}</p> : null}
    </div>
  );
}

function LotRow({
  lot,
  mid,
  fair,
  onFlatten,
  onSettle,
  onVoid,
}: {
  lot: BlotterLot;
  mid: number;
  fair: number;
  onFlatten: () => void;
  onSettle: (reason: Extract<CloseReason, "settle-yes" | "settle-no">) => void;
  onVoid: () => void;
}) {
  const expired = Date.parse(lot.closeTime) < Date.now();
  const mtm = lot.status === "open" ? lotPnl(lot, mid) : lotPnl(lot, 0);
  const model = lot.status === "open" ? lotPnl(lot, fair) : lotPnl(lot, 0);
  const markPx = lot.status === "open" ? sideMark(lot.side, mid) : lot.exitPrice ?? lot.fillPrice;

  return (
    <li className="flex flex-col gap-3 border-b border-border px-4 py-4 last:border-0 md:grid md:grid-cols-12 md:items-center md:gap-3">
      <div className="md:col-span-4 min-w-0">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
              lot.side === "yes" ? "bg-yes-dim text-yes" : "bg-no-dim text-no",
            )}
          >
            {lot.side.toUpperCase()}
          </span>
          {lot.source === "bot" ? (
            <span className="text-xs font-medium tracking-wide text-subtle uppercase">Bot</span>
          ) : null}
          {lot.status === "closed" ? (
            <span className="text-xs text-subtle">
              {lot.closeReason === "flatten"
                ? "Flattened"
                : lot.closeReason === "settle-yes"
                  ? "Settled YES"
                  : lot.closeReason === "settle-no"
                    ? "Settled NO"
                    : "Closed"}
            </span>
          ) : expired ? (
            <span className="text-xs text-no">Past close</span>
          ) : (
            <span className="text-xs text-subtle">Closes {relativeClose(lot.closeTime)}</span>
          )}
        </div>
        <Link
          to="/market/$ticker"
          params={{ ticker: lot.ticker }}
          className="block truncate text-sm font-medium hover:text-fg"
        >
          {lot.title}
        </Link>
        <p className="truncate text-xs text-muted">{lot.eventTitle}</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-sm md:col-span-4 md:grid-cols-4">
        <Cell label="Qty" value={String(lot.contracts)} />
        <Cell label="Fill" value={pct(lot.fillPrice)} />
        <Cell label={lot.status === "open" ? "Mark" : "Exit"} value={pct(markPx)} />
        <Cell label="Cost" value={`$${lotCost(lot).toFixed(2)}`} className="hidden md:flex" />
      </div>

      <div className="flex items-center justify-between gap-3 md:col-span-2 md:block md:text-right">
        <div>
          <p className="text-xs text-muted">Market / model</p>
          <p className="tabular-nums">
            <span className={cn(mtm >= 0 ? "text-yes" : "text-no")}>{usd(mtm)}</span>
            {lot.status === "open" ? (
              <>
                <span className="text-subtle"> · </span>
                <span className={cn(model >= 0 ? "text-yes" : "text-no")}>{usd(model)}</span>
              </>
            ) : null}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 md:col-span-2 md:justify-end">
        {lot.status === "open" ? (
          <>
            <Button type="button" size="sm" variant="secondary" onClick={onFlatten}>
              Flatten
            </Button>
            <Dialog>
              <DialogTrigger asChild>
                <Button type="button" size="sm" variant="ghost">
                  Settle
                </Button>
              </DialogTrigger>
              <DialogContent title="Settle this contract">
                <p className="text-sm text-muted">
                  Paper-settle {lot.contracts} {lot.side.toUpperCase()} as if Kalshi paid $1
                  or $0. This does not touch the live exchange.
                </p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button type="button" variant="yes" onClick={() => onSettle("settle-yes")}>
                    YES wins
                  </Button>
                  <Button type="button" variant="no" onClick={() => onSettle("settle-no")}>
                    NO wins
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
            <Button type="button" size="sm" variant="ghost" onClick={onVoid}>
              Void
            </Button>
          </>
        ) : (
          <span className="text-xs text-subtle">
            {lot.closedAt
              ? Date.now() - Date.parse(lot.closedAt) < 60_000
                ? "just now"
                : relativeClose(lot.closedAt)
              : ""}
          </span>
        )}
      </div>
    </li>
  );
}

function Cell({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <span className="text-xs text-muted">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
