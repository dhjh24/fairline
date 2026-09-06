import { Badge } from "@/components/ui/badge";
import type { Signal } from "@/lib/types";

export function SignalBadge({ signal }: { signal: Signal }) {
  const tone = signal === "yes" ? "yes" : signal === "no" ? "no" : "hold";
  const label = signal === "yes" ? "Buy YES" : signal === "no" ? "Buy NO" : "Hold";
  return <Badge tone={tone}>{label}</Badge>;
}
