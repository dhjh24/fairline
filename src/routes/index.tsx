import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { DeskView } from "@/components/desk-view";
import { getDesk } from "@/lib/desk-fn";

export const Route = createFileRoute("/")({
  loader: () => getDesk(),
  staleTime: 30_000,
  component: Home,
});

function Home() {
  const initial = Route.useLoaderData();
  const q = useQuery({
    queryKey: ["desk"],
    queryFn: () => getDesk(),
    initialData: initial,
    refetchInterval: 60_000,
  });

  return (
    <AppShell live={Boolean(q.data)}>
      <DeskView
        data={q.data}
        loading={q.isPending && !q.data}
        error={q.error ? "Could not load Kalshi books. Try again in a moment." : undefined}
        onRetry={() => q.refetch()}
      />
    </AppShell>
  );
}
