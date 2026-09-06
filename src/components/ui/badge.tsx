import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
  {
    variants: {
      tone: {
        yes: "bg-yes-dim text-yes",
        no: "bg-no-dim text-no",
        hold: "bg-elevated text-muted",
        mute: "bg-elevated text-muted",
        accent: "bg-accent text-accent-fg",
      },
    },
    defaultVariants: { tone: "mute" },
  },
);

export function Badge({
  className,
  tone,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
