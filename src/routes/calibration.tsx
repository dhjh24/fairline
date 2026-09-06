import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { CalibrationView } from "@/components/calibration-view";

export const Route = createFileRoute("/calibration")({
  component: CalibrationPage,
});

function CalibrationPage() {
  return (
    <AppShell>
      <CalibrationView />
    </AppShell>
  );
}
