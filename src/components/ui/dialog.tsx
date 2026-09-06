import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;

export function DialogContent({
  className,
  children,
  title,
}: {
  className?: string;
  children: ReactNode;
  title: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-bg/70" />
      <DialogPrimitive.Content
        className={cn(
          "fixed top-1/2 left-1/2 z-50 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 -translate-y-1/2",
          "rounded-xl bg-surface p-6 shadow-[var(--shadow-border),var(--shadow-elev)]",
          "max-h-[min(80dvh,40rem)] overflow-y-auto",
          className,
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <DialogPrimitive.Title className="text-lg font-medium tracking-tight">
            {title}
          </DialogPrimitive.Title>
          <DialogPrimitive.Close className="inline-flex size-10 items-center justify-center rounded-md text-muted transition-colors hover:bg-elevated hover:text-fg">
            <X className="size-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
