import { Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWatchlist } from "@/lib/watchlist";
import { cn } from "@/lib/utils";

export function StarButton({ ticker }: { ticker: string }) {
  const has = useWatchlist((s) => s.tickers.includes(ticker));
  const toggle = useWatchlist((s) => s.toggle);
  return (
    <Button
      type="button"
      variant="ghost"
      size="iconSm"
      aria-label={has ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={has}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(ticker);
      }}
    >
      <Star
        className={cn("size-4", has ? "fill-accent text-accent" : "text-subtle")}
      />
    </Button>
  );
}
