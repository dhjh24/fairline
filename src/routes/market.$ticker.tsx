import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { MarketDetailView } from "@/components/market-detail";
import { getMarketDetail } from "@/lib/desk-fn";

export const Route = createFileRoute("/market/$ticker")({
  loader: ({ params }) => getMarketDetail({ data: { ticker: params.ticker } }),
  staleTime: 20_000,
  component: MarketPage,
});

function MarketPage() {
  const { ticker } = Route.useParams();
  const initial = Route.useLoaderData();
  const q = useQuery({
    queryKey: ["market", ticker],
    queryFn: () => getMarketDetail({ data: { ticker } }),
    initialData: initial,
  });

  return (
    <AppShell live={Boolean(q.data)}>
      <MarketDetailView
        data={q.data}
        loading={q.isPending && !q.data}
        error={q.error ? "Could not load this market." : undefined}
        onRetry={() => q.refetch()}
      />
    </AppShell>
  );
}
