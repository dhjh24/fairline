import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-md bg-elevated px-3 text-sm text-fg shadow-[var(--shadow-border)] placeholder:text-subtle",
        "transition-[box-shadow] duration-150 ease-out",
        "focus-visible:outline-none focus-visible:shadow-[var(--shadow-border-hover)]",
        className,
      )}
      {...props}
    />
  );
}
