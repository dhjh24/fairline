import { LLM_PROVIDERS } from "@/lib/llm-providers";
import { cn } from "@/lib/utils";

export function ProviderPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Model">
      {LLM_PROVIDERS.map((p) => {
        const active = p.id === value;
        return (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(p.id)}
            className={cn(
              "h-8 rounded-sm px-2.5 text-xs transition-colors duration-150",
              active ? "bg-elevated text-fg" : "text-muted hover:text-fg",
              disabled && "opacity-40",
            )}
          >
            {p.label}
            <span className="ml-1.5 text-subtle">{p.hint}</span>
          </button>
        );
      })}
    </div>
  );
}
