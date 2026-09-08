import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CalibrationView } from "@/components/calibration-view";
import { getDesk } from "@/lib/desk-fn";

export const Route = createFileRoute("/calibration")({
  component: CalibrationPage,
});

function CalibrationPage() {
  const desk = useQuery({
    queryKey: ["desk"],
    queryFn: () => getDesk(),
    staleTime: 30_000,
    refetchInterval: 45_000,
  });

  return (
    <AppShell live={Boolean(desk.data)}>
      <CalibrationView
        desk={desk.data}
        deskError={desk.error ? "Could not refresh Kalshi books." : undefined}
        deskFetching={desk.isFetching && !desk.data}
      />
    </AppShell>
  );
}
