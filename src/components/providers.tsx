import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getQueryClient } from "@/lib/query";

export function Providers({ children }: { children: ReactNode }) {
  const client = getQueryClient();
  return (
    <QueryClientProvider client={client}>
      <TooltipProvider>{children}</TooltipProvider>
    </QueryClientProvider>
  );
}
