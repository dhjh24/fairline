import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo } from "react";
import { AppShell } from "@/components/app-shell";
import { BlotterView } from "@/components/blotter-view";
import { useBlotter } from "@/lib/blotter";
import { getDesk, markTickers } from "@/lib/desk-fn";

export const Route = createFileRoute("/blotter")({
  loader: () => getDesk(),
  staleTime: 30_000,
  component: BlotterPage,
});

function BlotterPage() {
  const initial = Route.useLoaderData();
  const applyMarks = useBlotter((s) => s.applyMarks);
  const lots = useBlotter((s) => s.lots);

  const desk = useQuery({
    queryKey: ["desk"],
    queryFn: () => getDesk(),
    initialData: initial,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!desk.data) return;
    applyMarks(
      desk.data.markets.map((m) => ({ ticker: m.ticker, mid: m.mid, fair: m.fair })),
    );
  }, [desk.data, applyMarks]);

  const missing = useMemo(() => {
    const onDesk = new Set(desk.data?.markets.map((m) => m.ticker) ?? []);
    return [
      ...new Set(
        lots
          .filter((l) => l.status === "open" && !onDesk.has(l.ticker))
          .map((l) => l.ticker),
      ),
    ];
  }, [lots, desk.data]);

  const extra = useQuery({
    queryKey: ["marks", missing],
    queryFn: () => markTickers({ data: { tickers: missing } }),
    enabled: missing.length > 0,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (!extra.data?.length) return;
    applyMarks(extra.data.map((m) => ({ ticker: m.ticker, mid: m.mid, fair: m.fair })));
  }, [extra.data, applyMarks]);

  return (
    <AppShell live={Boolean(desk.data)}>
      <BlotterView />
    </AppShell>
  );
}
